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
import { CARBON, CSS_FAILURE } from "../carbon-library";
import { LOG_PREFIX } from "../constants";
import {
  errorMessage,
  isCarbonSvelteImport,
  isCssFile,
  isScannableModule,
  stripQuery,
  toCssString,
} from "../utils";
import type { BundlerPlugin } from "./bundler-plugin";
import type { CssOptimizer, CssUsage } from "./create-optimized-css";
import { prepareCssPruning } from "./css-pruning";
import { contentScanWarning, NO_CARBON_IMPORTS } from "./messages";
import { optimizeAssets } from "./optimize-assets";
import { logSummary } from "./print-diff";
import { rewriteHeader } from "./rewrite-header";
import {
  type OptimizeCssOptions,
  checkRemovedOptions,
  sharesAnalysis,
  usageOptions,
} from "./options";
import { bundledStylesheets } from "./carbon-style-pruner";
import { carbonStylesheetClasses } from "./stylesheet-classes";
import { collectTokenNames, collectTokenReads } from "./token-names";
import { writePrunedCss } from "./rename-pruned-css";
import { collectCarbonTokens, scanContent } from "./scan-content";
import { hasOptimizableCss } from "./carbon-rules";

function hasCarbonCss(bundle: Rollup.OutputBundle): boolean {
  return Object.entries(bundle).some(
    ([id, file]) =>
      file.type === "asset" &&
      isCssFile(id) &&
      hasOptimizableCss(toCssString(file.source)),
  );
}

// Vite appends this to each CSS file so its hash changes with Vite's CSS
// handling, and strips it in its `generateBundle`; under Vite, this
// plugin's runs first, so it sees the marker.
const VITE_HASH_MARKER = /\/\*\$vite\$:\d+\*\//;

// HTML and SVG can name tokens, but the module graph holds their code as
// JS, so they're read from disk.
const RE_MARKUP_FILE = /\.(?:html?|svg)$/;
const RE_CARBON_STYLESHEET = /[\\/]carbon-components-svelte[\\/]/;

function isCarbonStylesheet(id: string): boolean {
  return RE_CARBON_STYLESHEET.test(id);
}

/** What `generateBundle` prunes with, decided before chunks are hashed. */
type Prepared = {
  optimizer: CssOptimizer;
  usage: CssUsage | undefined;
  moduleTokens: Set<string>;
  /** `--cds-` names the module graph's code and markup and `content` hold. */
  tokenNames: string[];
  /**
   * A hash of everything the pruning depends on besides the CSS, for the
   * names of the chunks whose code names CSS files.
   */
  fingerprint: string;
};

// Read from the graph's code because chunks are hashed before
// `generateBundle`, and the fingerprint needs them; and from the HTML and
// SVG files the graph reads, since `generateBundle` can run before Vite
// emits them. `written` holds the names code only sets or removes.
function graphTokenNames(
  context: Pick<Rollup.PluginContext, "getModuleIds" | "getModuleInfo">,
): { code: string[]; markup: string[]; written: string[] } {
  const code = new Set<string>();
  const markup = new Set<string>();
  const written = new Set<string>();
  for (const id of context.getModuleIds()) {
    const source = context.getModuleInfo(id)?.code;
    // A stylesheet names the tokens it defines too: only its reads count,
    // and not Carbon's own, whose pruned rules' reads don't.
    if (source && isCssFile(stripQuery(id))) {
      if (!isCarbonStylesheet(id)) collectTokenReads(source, code);
    } else if (source) collectTokenNames(source, code, written);
    if (RE_MARKUP_FILE.test(id) && existsSync(id)) {
      collectTokenNames(readFileSync(id, "utf8"), markup, written);
    }
  }
  return { code: [...code], markup: [...markup], written: [...written] };
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
  /** The Carbon stylesheets the pruner reads; see `bundledStylesheets`. */
  stylesheets: readonly string[];
  /** Every class the stylesheet defines, to hash which ones are pruned. */
  stylesheetClasses: readonly string[];
  usage: CssUsage | undefined;
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
  add("stylesheets", parts.stylesheets);
  const { usage } = parts;
  if (usage) {
    add("live", usage.liveComponents);
    add(
      "pruned",
      parts.stylesheetClasses.filter((cls) => usage.isPruned(cls)),
    );
  }
  if (parts.files)
    add(
      "files",
      parts.files.map((file) => file.code),
    );
  return hash.digest("hex").slice(0, 16);
}

const isCssName = (name: unknown): boolean =>
  typeof name === "string" && isCssFile(name);

// Whether a chunk's code can name a CSS file once Vite fills it in:
// `renderStart` asks before Vite has, so it goes by what could.
function namesCss(chunk: Rollup.RenderedChunk): boolean {
  if (chunk.dynamicImports.length > 0) return true;
  // Read so Rollup's `import.meta.ROLLUP_FILE_URL_x` and Vite's `?url`
  // imports count as uses.
  // Rollup's chunks have `referencedFiles`; Rolldown's type doesn't.
  const referenced: unknown = Reflect.get(chunk, "referencedFiles");
  if (Array.isArray(referenced) && referenced.some(isCssName)) return true;
  return [...(chunk.viteMetadata?.importedAssets ?? [])].some(isCssFile);
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
  checkRemovedOptions(options);
  const silent = options?.silent === true;
  // Kept across `vite build --watch` rebuilds, since Rollup serves
  // unchanged modules from cache without calling `transform`;
  // `generateBundle` keeps only ids still in the module graph.
  const ids = new Set<string>();
  let root = process.cwd();
  // Set by `configResolved`, which only Vite calls. Plain Rollup and
  // Rolldown log to the console instead, since their CLI writes plugin
  // logs to stderr.
  let logInfo: ((message: string) => void) | undefined;
  // Cached after a build's first scan, so the `content` globs are read
  // once per build.
  let contentClasses: string[] | undefined;
  let contentTokens: string[] = [];
  // Per module, like `ids`, so a module that leaves the graph takes its
  // classes with it.
  const moduleClasses = new Map<string, Set<string>>();
  // Only filled when CPS collects its own call sites, since the pruner
  // then reads their code.
  const moduleSources = new Map<string, string>();
  // Only when CPS collects its own call sites, without `shared`.
  let collector: UsageCollector | undefined;
  // Loaded in `buildStart`, so `transform` stays synchronous.
  let analyzer: typeof import("svelte-prune/internal/analysis") | undefined;
  // Kept since `optimizeComponents` shares its analysis through Vite's
  // resolved config.
  let config: object | undefined;
  // Set when `optimizeComponents` is in the build, so no collector is
  // made then.
  let shared: (() => SharedAnalysis | undefined) | undefined;
  let edges: LibraryImport[] = [];
  // Made once per build, so every output prunes the same way.
  let prepared: Promise<Prepared | undefined> | undefined;
  // Set once `prepared` settles, since `augmentChunkHash` is synchronous
  // and can't await it.
  let current: Prepared | undefined;

  async function prepare(
    this: Rollup.PluginContext,
  ): Promise<Prepared | undefined> {
    // Unit tests pass bare contexts without `getModuleIds`, so there
    // every module counts.
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
        : { code: [], markup: [], written: [] };
    const classes = [...contentClasses, ...moduleTokens];
    const stylesheets = graph ? bundledStylesheets(graph) : [];
    const usageCollector = collector;
    const { optimizer, usage, files } = await prepareCssPruning({
      options,
      root,
      classes,
      namedTokens: [
        ...contentTokens,
        ...graphTokens.code,
        ...graphTokens.markup,
      ],
      analyzer,
      stylesheets,
      shared,
      collect: usageCollector
        ? async () => ({
            result: await usageCollector.analyze(
              ids,
              usageOptions(options),
              edges,
            ),
            // What the app's modules name stays, unless `scanModules` is off.
            files:
              options?.scanModules === false
                ? []
                : [...moduleSources.values()].map((code) => ({ code })),
          })
        : undefined,
      warn: (message) => {
        if (!silent) this.warn(message);
      },
    });

    const namedTokens = [
      ...contentTokens,
      ...graphTokens.code,
      ...graphTokens.markup,
    ];
    return {
      optimizer,
      usage,
      moduleTokens,
      // What a script sets is declared at run time, for the warning.
      tokenNames: [...namedTokens, ...graphTokens.written],
      fingerprint: fingerprint({
        options,
        root,
        ids,
        classes,
        tokens: namedTokens,
        stylesheets,
        stylesheetClasses: carbonStylesheetClasses(root),
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
      if (ids.size === 0 && !silent && hasCarbonCss(bundle)) {
        this.warn(NO_CARBON_IMPORTS);
      }
      if (!silent) logSummary({ assets: [], rewritten, log: logInfo });
      return;
    }
    const { optimizer, usage, moduleTokens, tokenNames } = ready;

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
      log: logInfo,
      rewritten,
      tokenNames,
      warn: (message) => this.warn(message),
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
     * reused) and loads the analyzer while modules transform.
     */
    // Tests call it bare; bundlers always pass their options.
    async buildStart(inputOptions?: { plugins?: readonly object[] }) {
      contentClasses = undefined;
      prepared = undefined;
      current = undefined;
      if (sharesAnalysis(options)) {
        analyzer ??= await import("svelte-prune/internal/analysis");
        // Rollup and Rolldown have no config, so their plugins stand in for it.
        const build = config ?? inputOptions?.plugins;
        shared = build && analyzer.siblingAnalysis(build, CARBON.name);
      }
      if (!shared && !collector) {
        analyzer ??= await import("svelte-prune/internal/analysis");
        try {
          collector = analyzer.createUsageCollector(CARBON, root, CSS_FAILURE);
        } catch (error) {
          if (!silent) {
            this.warn(
              `${LOG_PREFIX} Carbon CSS is left unpruned in this build (${errorMessage(error)}).`,
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
  // What `optimizeComponents` rewrote, set as it prepares each build, so the
  // summary's header can name it.
  const header = rewriteHeader(plugin, silent);
  return plugin;
};
