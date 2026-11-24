import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  type ComponentOptimizer,
  createComponentOptimizer,
  type LibraryImport,
  libraryPaths,
} from "svelte-prune/internal";
import {
  CARBON,
  PROP_AWARE_FAILURE,
  SPECIALIZE_FAILURE,
} from "../carbon-library";
import { LOG_PREFIX } from "../constants";
import type { ComponentIndex } from "../indexer/build-index";
import { loadComponentIndex } from "../indexer/load-index";
import {
  errorMessage,
  isCarbonSvelteImport,
  isCssFile,
  isScannableModule,
  stripQuery,
} from "../utils";
import { prepareCssPruning } from "./css-pruning";
import { contentScanWarning, NO_CARBON_IMPORTS } from "./messages";
import { optimizeAssets } from "./optimize-assets";
import { logSummary } from "./print-diff";
import type { OptimizeComponentsOptions } from "./optimize-components";
import {
  type OptimizeCssOptions,
  propAwareOptions,
  sharesAnalysis,
} from "./options";
import { collectTokenNames, collectTokenReads } from "./prune-tokens";
import { collectCarbonTokens, scanContent } from "./scan-content";
import { hasOptimizableCss } from "./strict-css-optimizer";

export type CarbonOptimizerOptions = {
  /**
   * The project root: `content` globs resolve from it, and the installed
   * `carbon-components-svelte` is resolved from it.
   * @default process.cwd()
   */
  root?: string;
  /**
   * `optimizeComponents`' options, or `false` to bundle Carbon's components
   * unchanged. `hydration: false` needs Vite, Rollup or Rolldown, and is
   * ignored here.
   * @default {}
   */
  optimizeComponents?: OptimizeComponentsOptions | false;
  /**
   * `optimizeCss`' options, or `false` to leave CSS unpruned. `propAware`
   * prunes from `optimizeComponents`' analysis when that's on, as in a Vite
   * build with both plugins.
   * @default {}
   */
  optimizeCss?: OptimizeCssOptions | false;
};

/** A module the build bundled. */
export type CarbonBuildModule = {
  /** The file's absolute path, or the bundler's name for a virtual module. */
  id: string;
  /**
   * Its source before Svelte compiles it: for a component `load` rewrote,
   * the rewritten one. Omit for a module with none (a virtual module).
   */
  code?: string;
  /**
   * The modules it imports, by `id`, with the specifier as written
   * (`"$lib/Card.svelte"`), and whether through `import()`.
   */
  imports?: Iterable<{ id: string; specifier?: string; dynamic?: boolean }>;
  /** Whether the bundler loads it directly: an entry point. */
  entry?: boolean;
};

type CarbonBuild = {
  /** Every module the build bundled. */
  modules: Iterable<CarbonBuildModule>;
  /** The CSS to prune, by name. */
  css?: Record<string, string>;
  /**
   * Everything else the build ships, by name: the Carbon tokens (`--cds-*`)
   * its JS and HTML name, and its other CSS reads, stay.
   */
  output?: Record<string, string>;
};

/** A component as `load` rewrote it, with a source map to the original. */
export type RewrittenComponent = {
  code: string;
  map: {
    version: 3;
    sources: string[];
    sourcesContent: string[];
    names: string[];
    mappings: string;
  };
};

export type CarbonOptimizer = {
  /**
   * Before the build: reads the `content` files, rewrites the Carbon
   * components they render (and the app's own wrappers) for their props,
   * and loads the index the CSS is pruned with. Call it again before each
   * rebuild. `resolve` resolves an aliased import (`$lib/Card.svelte`) the
   * way the bundler does.
   */
  prepare(
    resolve?: (
      specifier: string,
      importer: string,
    ) => Promise<string | undefined>,
  ): Promise<void>;
  /**
   * The rewritten source of `.svelte` file `id` (an absolute path), for the
   * Svelte plugin to compile instead of the file's; `undefined` to compile
   * the file as it is.
   */
  load(id: string): RewrittenComponent | undefined;
  /**
   * After the build: fails if a module the build bundled renders Carbon
   * components in a way the rewrite didn't read (outside `content`,
   * through an alias), as the Vite plugin does. Then prunes `build.css`,
   * returning it by the same names.
   */
  finish(build: CarbonBuild): Promise<Record<string, string>>;
};

/** Files the module graph reads that can name tokens, but whose code is JS. */
const RE_MARKUP_FILE = /\.(?:html?|svg)$/;
const RE_CARBON_STYLESHEET = /[\\/]carbon-components-svelte[\\/]/;
/** Specifiers that can't be an alias of Carbon, as svelte-prune reads them. */
const NOT_AN_ALIAS = /^(?:\.|\/|\0|svelte(?:\/|$))/;

/**
 * `optimizeComponents` and `optimizeCss` for a build without their Vite or
 * webpack hooks: `prepare` before it, `load` from the Svelte plugin's load
 * step, and `finish` with the module graph and CSS after it. The CSS loses
 * the same rules as in a Vite build of the same app with both plugins.
 */
export function createCarbonOptimizer(
  options: CarbonOptimizerOptions = {},
): CarbonOptimizer {
  const root = path.resolve(options.root ?? process.cwd());
  const componentOptions =
    options.optimizeComponents === false
      ? undefined
      : (options.optimizeComponents ?? {});
  const cssOptions =
    options.optimizeCss === false ? undefined : (options.optimizeCss ?? {});
  const propAware = cssOptions && propAwareOptions(cssOptions);
  const silent = cssOptions?.silent === true;
  const warn = (message: string) => {
    if (!silent) console.warn(message);
  };
  const library = libraryPaths(CARBON);

  const components: ComponentOptimizer | undefined =
    componentOptions &&
    createComponentOptimizer(
      CARBON,
      // Removing Svelte's hydration code needs the bundler to transform
      // its runtime and hand over its chunks: Vite's plugin does.
      { ...componentOptions, hydration: undefined },
      { plugin: "optimizeComponents", failure: SPECIALIZE_FAILURE },
    );
  let index: ComponentIndex | undefined;
  /** Carbon components this build rewrote, for the summary's header; 0 when silent. */
  let rewritten = 0;
  let analyzer: typeof import("svelte-prune/internal/analysis") | undefined;

  function checkComponents(modules: CarbonBuildModule[]): void {
    if (!components) return;
    /** Each module's importers; `undefined` for the bundler, for an entry. */
    const graph = new Map<
      string,
      { importers: Array<string | undefined>; dynamic: string[] }
    >();
    const node = (id: string) => {
      let found = graph.get(id);
      if (!found) graph.set(id, (found = { importers: [], dynamic: [] }));
      return found;
    };
    for (const module of modules) {
      if (module.code !== undefined) components.check(module.id, module.code);
      if (module.entry) node(module.id).importers.push(undefined);
      for (const edge of module.imports ?? []) {
        if (edge.id === module.id) continue;
        const target = node(edge.id);
        if (edge.dynamic) target.dynamic.push(module.id);
        else target.importers.push(module.id);
      }
    }
    for (const edge of libraryEdges(modules)) {
      components.checkLibraryImport(edge);
    }
    for (const [id, { importers, dynamic }] of graph) {
      if (id.endsWith(".js") && components.load(id)) {
        components.checkScriptImporters(id, [...importers, ...dynamic]);
      }
      if (components.isClosed(id)) {
        components.checkImporters(id, importers, dynamic.length > 0);
      }
    }
    const error = components.error();
    if (error) throw new Error(error);
  }

  /**
   * The edges into Carbon from outside it, with the specifier of one that
   * may be an alias, as svelte-prune's `libraryImports` reads a Vite graph.
   */
  function libraryEdges(modules: CarbonBuildModule[]): LibraryImport[] {
    const edges: LibraryImport[] = [];
    for (const module of modules) {
      if (library.moduleKey(stripQuery(module.id))) continue;
      for (const { id, specifier } of module.imports ?? []) {
        if (!library.importKey(id)) continue;
        const aliased =
          specifier !== undefined &&
          !library.isSpecifier(specifier) &&
          !NOT_AN_ALIAS.test(specifier);
        edges.push(
          aliased
            ? { id, importer: module.id, specifier }
            : { id, importer: module.id },
        );
      }
    }
    return edges;
  }

  async function pruneCss(
    modules: CarbonBuildModule[],
    build: CarbonBuild,
    rewritten: number,
  ): Promise<{ css: Record<string, string>; logged: boolean }> {
    const css = { ...build.css };
    const skip = { css, logged: false };
    if (!cssOptions || Object.keys(css).length === 0) return skip;
    // `loadComponentIndex` already warned.
    if (!index) return skip;

    const ids = new Set(
      modules.map(({ id }) => id).filter((id) => isCarbonSvelteImport(id)),
    );
    if (ids.size === 0) {
      if (Object.values(css).some((source) => hasOptimizableCss(source))) {
        warn(NO_CARBON_IMPORTS);
      }
      return skip;
    }

    const moduleClasses = new Set<string>();
    /** `--cds-` names the modules' code reads, as `optimizeCss` reads Vite's graph. */
    const codeTokens = new Set<string>();
    const markupTokens = new Set<string>();
    const sources: Array<{ id: string; code: string }> = [];
    for (const { id, code } of modules) {
      if (code !== undefined) {
        // A stylesheet names the tokens it defines too: only its reads
        // count, and not Carbon's own, whose pruned rules' reads don't.
        if (isCssFile(stripQuery(id))) {
          if (!RE_CARBON_STYLESHEET.test(id))
            collectTokenReads(code, codeTokens);
        } else collectTokenNames(code, codeTokens);
        if (isScannableModule(id) && !isCarbonSvelteImport(id)) {
          sources.push({ id, code });
          if (cssOptions.scanModules !== false) {
            collectCarbonTokens(code, moduleClasses);
          }
        }
      }
      if (RE_MARKUP_FILE.test(id) && existsSync(id)) {
        collectTokenNames(readFileSync(id, "utf8"), markupTokens);
      }
    }

    // What the rest of the build ships: the names its JS and HTML hold,
    // and what its other CSS reads. Not CSS with Carbon's rules, which
    // reads every token they do, pruned or not.
    const outputTokens = new Set<string>();
    const outputReads = new Set<string>();
    for (const [name, code] of Object.entries(build.output ?? {})) {
      if (!isCssFile(name)) collectTokenNames(code, outputTokens);
      else if (!hasOptimizableCss(code)) collectTokenReads(code, outputReads);
    }

    const scan = scanContent(cssOptions.content, root);
    const warning = contentScanWarning(cssOptions.content, root, scan);
    if (warning) warn(warning);

    const loaded = analyzer;
    const shared =
      propAware && components && sharesAnalysis(propAware)
        ? () => components.shared
        : undefined;
    const { optimizer, usage } = await prepareCssPruning({
      options: cssOptions,
      root,
      components: index,
      ids,
      classes: [...scan.classes, ...moduleClasses],
      namedTokens: [
        ...scan.tokens,
        ...codeTokens,
        ...markupTokens,
        ...outputReads,
      ],
      analyzer: loaded,
      shared,
      collect:
        propAware && loaded && !shared
          ? async () => {
              const collector = (() => {
                try {
                  return loaded.createUsageCollector(
                    CARBON,
                    root,
                    PROP_AWARE_FAILURE,
                  );
                } catch (error) {
                  warn(
                    `${LOG_PREFIX} propAware is off for this build (${errorMessage(error)}).`,
                  );
                  return undefined;
                }
              })();
              if (!collector) return undefined;
              for (const { id, code } of sources) collector.add(id, code);
              return {
                result: await collector.analyze(
                  ids,
                  propAware,
                  libraryEdges(modules),
                ),
                files: sources.map(({ code }) => ({ code })),
              };
            }
          : undefined,
      warn,
    });

    const logged = optimizeAssets({
      rewritten,
      assets: Object.entries(css).map(([id, source]) => ({
        id,
        source,
        write: (pruned: string) => {
          css[id] = pruned;
        },
      })),
      optimizer,
      options: cssOptions,
      moduleTokens: moduleClasses.size,
      contentTokens: scan.classes.length,
      tokenNames: [
        ...outputTokens,
        ...outputReads,
        ...markupTokens,
        ...scan.tokens,
      ],
      reportExtra: () =>
        usage?.report?.(optimizer.usage.prunedByProps, root) ?? [],
    });
    return { css, logged };
  }

  return {
    async prepare(resolve) {
      if (componentOptions?.hydration === false && !componentOptions.silent) {
        console.warn(
          `${LOG_PREFIX} optimizeComponents ignored \`hydration: false\`, which needs Vite, Rollup or Rolldown.`,
        );
      }
      if (components) {
        const { warning, summary, report } = await components.prepare(
          root,
          resolve,
        );
        rewritten = componentOptions?.silent ? 0 : (summary?.components ?? 0);
        if (warning) console.warn(warning);
        for (const line of report ?? []) console.log(line);
      }
      if (cssOptions) {
        index = await loadComponentIndex(root);
        if (propAware) {
          analyzer ??= await import("svelte-prune/internal/analysis");
        }
      }
    },
    load(id) {
      return components?.load(id);
    },
    async finish(build) {
      const modules = [...build.modules];
      checkComponents(modules);
      const { css, logged } = await pruneCss(modules, build, rewritten);
      if (rewritten > 0 && !logged) logSummary({ assets: [], rewritten });
      return css;
    },
  };
}
