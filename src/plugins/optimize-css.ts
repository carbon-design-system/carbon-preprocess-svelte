import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type LibraryImport, libraryImports } from "svelte-prune/internal";
import type {
  SharedAnalysis,
  UsageCollector,
} from "svelte-prune/internal/analysis";
import type { Plugin, Rollup } from "vite";
import { version as OWN_VERSION } from "../../package.json";
import { CARBON, PROP_AWARE_FAILURE } from "../carbon-library";
import { LOG_PREFIX } from "../constants";
import type { ComponentIndex } from "../indexer/build-index";
import { loadComponentIndex } from "../indexer/load-index";
import {
  errorMessage,
  isCarbonSvelteImport,
  isCssFile,
  isScannableModule,
  stripQuery,
  toCssString,
} from "../utils";
import type { BundlerPlugin } from "./bundler-plugin";
import type { CssOptimizer, PropAwareUsage } from "./create-optimized-css";
import { prepareCssPruning } from "./css-pruning";
import { contentScanWarning, NO_CARBON_IMPORTS } from "./messages";
import { optimizeAssets } from "./optimize-assets";
import { logSummary } from "./print-diff";
import { rewriteHeader } from "./rewrite-header";
import {
  type OptimizeCssOptions,
  propAwareOptions,
  sharesAnalysis,
} from "./options";
import {
  canNameTokens,
  collectTokenNames,
  collectTokenReads,
} from "./prune-tokens";
import { writePrunedCss } from "./rename-pruned-css";
import { collectCarbonTokens, scanContent } from "./scan-content";
import { hasOptimizableCss } from "./strict-css-optimizer";

/**
 * `--cds-` names in everything the bundle ships besides CSS: chunks, and
 * text assets like `index.html`.
 */
function bundleTokenNames(bundle: Rollup.OutputBundle): Set<string> {
  const names = new Set<string>();
  for (const [id, file] of Object.entries(bundle)) {
    if (file.type === "chunk") collectTokenNames(file.code, names);
    else if (canNameTokens(id)) {
      collectTokenNames(toCssString(file.source), names);
    }
  }
  return names;
}

/** True if any emitted CSS asset has Carbon rules the optimizer can prune. */
function hasCarbonCss(bundle: Rollup.OutputBundle): boolean {
  return Object.entries(bundle).some(
    ([id, file]) =>
      file.type === "asset" &&
      isCssFile(id) &&
      hasOptimizableCss(toCssString(file.source)),
  );
}

/**
 * What Vite appends to each CSS file so its hash changes with Vite's CSS
 * handling, and strips in its `generateBundle`: under Vite, this plugin's
 * runs first.
 */
const VITE_HASH_MARKER = /\/\*\$vite\$:\d+\*\//;

/** Files the module graph reads that can name tokens, but whose code is JS. */
const RE_MARKUP_FILE = /\.(?:html?|svg)$/;
const RE_CARBON_STYLESHEET = /[\\/]carbon-components-svelte[\\/]/;

function isCarbonStylesheet(id: string): boolean {
  return RE_CARBON_STYLESHEET.test(id);
}

/** What `generateBundle` prunes with, decided before chunks are hashed. */
type Prepared = {
  optimizer: CssOptimizer;
  usage: PropAwareUsage | undefined;
  moduleTokens: Set<string>;
  /**
   * `--cds-` names in the HTML and SVG files the module graph reads:
   * `generateBundle` can run before Vite emits `index.html`.
   */
  markupTokens: string[];
  /**
   * A hash of everything the pruning depends on besides the CSS, for the
   * names of the chunks whose code names CSS files.
   */
  fingerprint: string;
};

/**
 * `--cds-` names in the module graph: in its code, which the fingerprint
 * reads because chunks are hashed before `generateBundle`, and in the HTML
 * and SVG files it reads, which `generateBundle` can run before
 * Vite emits.
 */
function graphTokenNames(
  context: Pick<Rollup.PluginContext, "getModuleIds" | "getModuleInfo">,
): { code: string[]; markup: string[] } {
  const code = new Set<string>();
  const markup = new Set<string>();
  for (const id of context.getModuleIds()) {
    const source = context.getModuleInfo(id)?.code;
    // A stylesheet names the tokens it defines too: only its reads count,
    // and not Carbon's own, whose pruned rules' reads don't.
    if (source && isCssFile(stripQuery(id))) {
      if (!isCarbonStylesheet(id)) collectTokenReads(source, code);
    } else if (source) collectTokenNames(source, code);
    if (RE_MARKUP_FILE.test(id) && existsSync(id)) {
      collectTokenNames(readFileSync(id, "utf8"), markup);
    }
  }
  return { code: [...code], markup: [...markup] };
}

function serializeOption(_: string, value: unknown): unknown {
  return value instanceof RegExp ? String(value) : value;
}

function fingerprint(parts: {
  options: OptimizeCssOptions | undefined;
  root: string;
  ids: Iterable<string>;
  classes: Iterable<string>;
  tokens: Iterable<string>;
  components: ComponentIndex;
  usage: PropAwareUsage | undefined;
  files: ReadonlyArray<{ code: string }> | undefined;
}): string {
  const hash = createHash("sha256");
  const add = (label: string, values: Iterable<string>) => {
    hash.update(`${label}\0${[...new Set(values)].sort().join("\0")}\n`);
  };
  add("version", [OWN_VERSION]);
  add("options", [JSON.stringify(parts.options ?? {}, serializeOption)]);
  add(
    "ids",
    [...parts.ids].map((id) =>
      path.relative(parts.root, id).replaceAll("\\", "/"),
    ),
  );
  add("classes", parts.classes);
  add("tokens", parts.tokens);
  const { usage } = parts;
  if (usage) {
    add("live", usage.liveComponents);
    const classes = Object.values(parts.components).flatMap(
      (entry) => entry.classes,
    );
    add(
      "pruned",
      classes.filter((cls) => usage.isPruned(cls)),
    );
  }
  if (parts.files)
    add(
      "files",
      parts.files.map((file) => file.code),
    );
  return hash.digest("hex").slice(0, 16);
}

/** Whether a chunk's code can name a CSS file once Vite fills it in. */
function namesCss(chunk: Rollup.RenderedChunk): boolean {
  if (chunk.dynamicImports.length > 0) return true;
  // Rollup's `import.meta.ROLLUP_FILE_URL_x`, and Vite's `?url` imports.
  const { referencedFiles, viteMetadata } = chunk as {
    referencedFiles?: readonly string[];
    viteMetadata?: { importedAssets?: Set<string> };
  };
  if (referencedFiles?.some(isCssFile)) return true;
  return [...(viteMetadata?.importedAssets ?? [])].some(isCssFile);
}

/**
 * Vite/Rollup plugin that removes unused Carbon CSS from
 * production builds.
 *
 * `transform` records which Carbon components are imported. `renderStart`
 * decides what to keep, and folds a hash of it into the names of the
 * chunks that name CSS. `generateBundle` then splices unused rules out of
 * the CSS assets, renaming each whose name hashes its content.
 */
export const optimizeCss = (options?: OptimizeCssOptions): BundlerPlugin => {
  const silent = options?.silent === true;
  /**
   * Carbon component files seen by `transform`, across `vite build --watch`
   * rebuilds. Rollup serves unchanged modules from cache without calling
   * `transform`, so `generateBundle` keeps only ids still in the
   * module graph.
   */
  const ids = new Set<string>();
  let root = process.cwd();
  /**
   * Set by `configResolved`, which only Vite calls. Plain Rollup and
   * Rolldown log to the console instead: their CLI writes plugin logs
   * to stderr.
   */
  let logInfo: ((message: string) => void) | undefined;
  /** Classes from `content` globs; cached after the first scan of a build. */
  let contentClasses: string[] | undefined;
  /** `--cds-` names from `content` globs, scanned with `contentClasses`. */
  let contentTokens: string[] = [];
  /**
   * Literal `bx--` classes in each scanned module, kept per module
   * like `ids`.
   */
  const moduleClasses = new Map<string, Set<string>>();
  /**
   * Each scanned module's code, for the pruner, when CPS collects its own
   * call sites.
   */
  const moduleSources = new Map<string, string>();
  /** The installed Carbon's index; `undefined` leaves CSS unpruned. */
  let components: ComponentIndex | undefined;
  const propAware = propAwareOptions(options);
  /** Call sites per module for `propAware`. */
  let collector: UsageCollector | undefined;
  /** Loaded in `buildStart`, so `transform` stays synchronous. */
  let analyzer: typeof import("svelte-prune/internal/analysis") | undefined;
  /** Vite's resolved config, where `optimizeComponents` shares its analysis. */
  let config: object | undefined;
  /**
   * `optimizeComponents`' analysis, when it's in the build: no
   * collector then.
   */
  let shared: (() => SharedAnalysis | undefined) | undefined;
  /** The module graph's edges into Carbon, read in `buildEnd`. */
  let edges: LibraryImport[] = [];
  /** This build's pruning, made once for every output. */
  let prepared: Promise<Prepared | undefined> | undefined;
  /** Set once `prepared` settles, for the synchronous `augmentChunkHash`. */
  let current: Prepared | undefined;

  async function prepare(
    this: Rollup.PluginContext,
  ): Promise<Prepared | undefined> {
    // `loadComponentIndex` already warned.
    if (!components) return undefined;

    // Absent on the bare contexts unit tests pass, where everything counts.
    const graph = this.getModuleIds ? new Set(this.getModuleIds()) : undefined;
    if (graph) {
      for (const id of ids) if (!graph.has(id)) ids.delete(id);
      for (const id of moduleClasses.keys()) {
        if (!graph.has(id)) moduleClasses.delete(id);
      }
      for (const id of moduleSources.keys()) {
        if (!graph.has(id)) moduleSources.delete(id);
      }
      collector?.retain(graph);
    }
    const moduleTokens = new Set<string>();
    for (const tokens of moduleClasses.values()) {
      for (const token of tokens) moduleTokens.add(token);
    }

    // A secondary build that never imports Carbon has nothing to prune.
    if (ids.size === 0) return undefined;

    if (contentClasses === undefined) {
      const scan = scanContent(options?.content, root);
      const warning = contentScanWarning(options?.content, root, scan);
      if (!silent && warning) this.warn(warning);
      contentClasses = scan.classes;
      contentTokens = scan.tokens;
    }

    const graphTokens =
      typeof this.getModuleInfo === "function"
        ? graphTokenNames(this)
        : { code: [], markup: [] };
    const classes = [...contentClasses, ...moduleTokens];
    const usageCollector = collector;
    const { optimizer, usage, files } = await prepareCssPruning({
      options,
      root,
      components,
      ids,
      classes,
      namedTokens: [
        ...contentTokens,
        ...graphTokens.code,
        ...graphTokens.markup,
      ],
      analyzer,
      shared: propAware ? shared : undefined,
      collect:
        usageCollector && propAware
          ? async () => ({
              result: await usageCollector.analyze(ids, propAware, edges),
              files: [...moduleSources.values()].map((code) => ({ code })),
            })
          : undefined,
      warn: (message) => {
        if (!silent) this.warn(message);
      },
    });

    return {
      optimizer,
      usage,
      moduleTokens,
      markupTokens: graphTokens.markup,
      fingerprint: fingerprint({
        options,
        root,
        ids,
        classes,
        tokens: [...contentTokens, ...graphTokens.code, ...graphTokens.markup],
        components,
        usage,
        files,
      }),
    };
  }

  async function generateBundle(
    this: Rollup.PluginContext,
    outputOptions: Rollup.NormalizedOutputOptions,
    bundle: Rollup.OutputBundle,
  ): Promise<void> {
    // Bare unit-test contexts skip `renderStart`.
    prepared ??= prepare.call(this);
    const ready = await prepared;
    const { rewritten } = header;
    if (!ready) {
      if (components && ids.size === 0 && !silent && hasCarbonCss(bundle)) {
        this.warn(NO_CARBON_IMPORTS);
      }
      if (!silent) logSummary({ assets: [], rewritten, log: logInfo });
      return;
    }
    const { optimizer, usage, moduleTokens, markupTokens } = ready;

    const pruned = new Map<string, string>();
    optimizeAssets({
      assets: Object.entries(bundle).flatMap(([id, file]) => {
        if (file.type !== "asset" || !isCssFile(id)) return [];
        // Measured and pruned without Vite's marker, which goes back on so
        // Vite hashes and strips it as it would have.
        const css = toCssString(file.source);
        const marker = VITE_HASH_MARKER.exec(css)?.[0] ?? "";
        return [
          {
            id,
            source: marker ? css.replace(marker, "") : css,
            write: (pruneResult: string) => {
              pruned.set(id, pruneResult + marker);
            },
          },
        ];
      }),
      optimizer,
      options: options ?? {},
      moduleTokens: moduleTokens.size,
      contentTokens: contentClasses?.length ?? 0,
      tokenNames: [
        ...bundleTokenNames(bundle),
        ...markupTokens,
        ...contentTokens,
      ],
      log: logInfo,
      rewritten,
      reportExtra: () =>
        usage?.report?.(optimizer.usage.prunedByProps, root) ?? [],
    });
    writePrunedCss(this, bundle, pruned, outputOptions?.assetFileNames);
  }

  const plugin: Plugin = {
    name: "vite:carbon:optimize-css",
    apply: "build",
    enforce: "post",
    configResolved(resolved) {
      config = resolved;
      root = resolved.root;
      // Not `this.info`: it prefixes the plugin name and is absent on Rollup 2.
      logInfo = (message) => resolved.logger.info(message);
      // Vite emits CSS before `generateBundle`, so prune and rename it before
      // other plugins copy the names: Vite's HTML, Astro's pages. With
      // `cssCodeSplit: false`, Vite emits it in `generateBundle`: after that.
      // Plain Rollup's CSS plugins emit it there too, so it keeps the order.
      plugin.generateBundle =
        resolved.build && resolved.build.cssCodeSplit !== false
          ? { order: "pre", handler: generateBundle }
          : generateBundle;
    },
    /**
     * Re-reads `content` on `--watch` rebuilds (the plugin instance is
     * reused) and loads the component index while modules transform.
     */
    // Tests call it bare; bundlers always pass their options.
    async buildStart(inputOptions?: { plugins?: readonly object[] }) {
      contentClasses = undefined;
      prepared = undefined;
      current = undefined;
      components = await loadComponentIndex(root);
      if (propAware && sharesAnalysis(propAware)) {
        analyzer ??= await import("svelte-prune/internal/analysis");
        // Rollup and Rolldown have no config: their plugins, then.
        const build = config ?? inputOptions?.plugins;
        shared = build && analyzer.siblingAnalysis(build, CARBON.name);
      }
      if (propAware && !shared && !collector) {
        analyzer ??= await import("svelte-prune/internal/analysis");
        try {
          collector = analyzer.createUsageCollector(
            CARBON,
            root,
            PROP_AWARE_FAILURE,
          );
        } catch (error) {
          if (!silent) {
            this.warn(
              `${LOG_PREFIX} propAware is off for this build (${errorMessage(error)}).`,
            );
          }
        }
      }
    },
    async buildEnd() {
      // The module graph is only complete, and `this.resolve` only works,
      // in the build phase.
      edges =
        collector && typeof this.getModuleIds === "function"
          ? await libraryImports(CARBON, this)
          : [];
    },
    transform(code, id) {
      if (isCarbonSvelteImport(id)) {
        ids.add(id);
        return;
      }
      // Virtual modules too: one may render the app's own components.
      if (collector && (isScannableModule(id) || id.startsWith("\0"))) {
        collector.add(id, code);
        if (isScannableModule(id)) moduleSources.set(id, code);
      }
      if (options?.scanModules !== false && isScannableModule(id)) {
        const tokens = new Set<string>();
        collectCarbonTokens(code, tokens);
        // Replace, don't merge: an edit that removes a class must drop it.
        if (tokens.size > 0) moduleClasses.set(id, tokens);
        else moduleClasses.delete(id);
      }
    },
    async renderStart() {
      prepared ??= prepare.call(this);
      current = await prepared;
    },
    augmentChunkHash(chunk) {
      if (current && namesCss(chunk)) return current.fingerprint;
    },
    generateBundle,
  };
  // What `optimizeComponents` rewrote, set as it prepares each build.
  const header = rewriteHeader(plugin, silent);
  return plugin;
};
