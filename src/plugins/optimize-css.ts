import { type LibraryImport, libraryImports } from "svelte-prune/internal";
import type {
  SharedAnalysis,
  UsageCollector,
} from "svelte-prune/internal/analysis";
import type { Plugin, Rollup } from "vite";
import { CARBON, PROP_AWARE_FAILURE } from "../carbon-library";
import { LOG_PREFIX } from "../constants";
import type { ComponentIndex } from "../indexer/build-index";
import { loadComponentIndex } from "../indexer/load-index";
import {
  errorMessage,
  isCarbonSvelteImport,
  isCssFile,
  isScannableModule,
  toCssString,
} from "../utils";
import type { BundlerPlugin } from "./bundler-plugin";
import {
  type CssOptimizerOptions,
  createCssOptimizer,
  type PropAwareUsage,
  propAwareUsage,
} from "./create-optimized-css";
import {
  contentScanWarning,
  NO_CARBON_IMPORTS,
  SHARED_ANALYSIS_FAILED,
} from "./messages";
import { optimizeAssets } from "./optimize-assets";
import {
  type OptimizeCssOptions,
  propAwareOptions,
  sharesAnalysis,
} from "./options";
import { canNameTokens, collectTokenNames } from "./prune-tokens";
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
 * Vite/Rollup plugin that removes unused Carbon CSS from production builds.
 *
 * `transform` records which Carbon components are imported; `generateBundle`
 * then splices unused rules out of the CSS assets in place.
 */
export const optimizeCss = (options?: OptimizeCssOptions): BundlerPlugin => {
  const silent = options?.silent === true;
  /**
   * Carbon component files seen by `transform`, across `vite build --watch`
   * rebuilds. Rollup serves unchanged modules from cache without calling
   * `transform`, so `generateBundle` keeps only ids still in the module graph.
   */
  const ids = new Set<string>();
  let root = process.cwd();
  /**
   * Set by `configResolved`, which only Vite calls. Plain Rollup and Rolldown
   * log to the console instead: their CLI writes plugin logs to stderr.
   */
  let logInfo: ((message: string) => void) | undefined;
  /** Classes from `content` globs; cached after the first scan of a build. */
  let contentClasses: string[] | undefined;
  /** `--cds-` names from `content` globs, scanned with `contentClasses`. */
  let contentTokens: string[] = [];
  /** Literal `bx--` classes in each scanned module, kept per module like `ids`. */
  const moduleClasses = new Map<string, Set<string>>();
  /** The installed Carbon's index; `undefined` leaves CSS unpruned. */
  let components: ComponentIndex | undefined;
  const propAware = propAwareOptions(options);
  /** Call sites per module for `propAware`. */
  let collector: UsageCollector | undefined;
  /** Loaded in `buildStart`, so `transform` stays synchronous. */
  let analyzer: typeof import("svelte-prune/internal/analysis") | undefined;
  /** Vite's resolved config, where `optimizeComponents` shares its analysis. */
  let config: object | undefined;
  /** `optimizeComponents`' analysis, when it's in the build: no collector then. */
  let shared: (() => SharedAnalysis | undefined) | undefined;
  /** The module graph's edges into Carbon, read in `buildEnd`. */
  let edges: LibraryImport[] = [];

  const plugin: Plugin = {
    name: "vite:carbon:optimize-css",
    apply: "build",
    enforce: "post",
    configResolved(resolved) {
      config = resolved;
      root = resolved.root;
      // Not `this.info`: it prefixes the plugin name and is absent on Rollup 2.
      logInfo = (message) => resolved.logger.info(message);
    },
    /**
     * Re-reads `content` on `--watch` rebuilds (the plugin instance is
     * reused) and loads the component index while modules transform.
     */
    // Tests call it bare; bundlers always pass their options.
    async buildStart(inputOptions?: { plugins?: readonly object[] }) {
      contentClasses = undefined;
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
      }
      if (options?.scanModules !== false && isScannableModule(id)) {
        const tokens = new Set<string>();
        collectCarbonTokens(code, tokens);
        // Replace, don't merge: an edit that removes a class must drop it.
        if (tokens.size > 0) moduleClasses.set(id, tokens);
        else moduleClasses.delete(id);
      }
    },
    async generateBundle(_, bundle) {
      // `loadComponentIndex` already warned.
      if (!components) return;

      // Absent on the bare contexts unit tests pass, where everything counts.
      const graph = this.getModuleIds
        ? new Set(this.getModuleIds())
        : undefined;
      if (graph) {
        for (const id of ids) if (!graph.has(id)) ids.delete(id);
        for (const id of moduleClasses.keys()) {
          if (!graph.has(id)) moduleClasses.delete(id);
        }
        collector?.retain(graph);
      }
      const moduleTokens = new Set<string>();
      for (const tokens of moduleClasses.values()) {
        for (const token of tokens) moduleTokens.add(token);
      }

      if (ids.size === 0) {
        // A secondary build that never imports Carbon has nothing to prune.
        if (!silent && hasCarbonCss(bundle)) this.warn(NO_CARBON_IMPORTS);
        return;
      }

      if (contentClasses === undefined) {
        const scan = scanContent(options?.content, root);
        const warning = contentScanWarning(options?.content, root, scan);
        if (!silent && warning) this.warn(warning);
        contentClasses = scan.classes;
        contentTokens = scan.tokens;
      }

      let usage: PropAwareUsage | undefined;
      let engine: CssOptimizerOptions["engine"];
      if (shared && propAware) {
        // The same reading of the call sites `optimizeComponents` rewrote for.
        const analysis = shared();
        if (analysis && !("warning" in analysis) && analyzer) {
          usage = analysis.usage;
          engine = {
            analyzer,
            root,
            loadable: analysis.usage.loadable,
            files: analysis.files,
          };
        } else if (!silent) this.warn(SHARED_ANALYSIS_FAILED);
      } else if (collector && analyzer && propAware) {
        const result = await collector.analyze(ids, propAware, edges);
        if (!("warning" in result)) usage = propAwareUsage(result, analyzer);
        else if (!silent) this.warn(result.warning);
      }

      const optimizer = createCssOptimizer({
        ...options,
        components,
        ids,
        contentClasses: [...contentClasses, ...moduleTokens],
        propAware: usage,
        engine,
      });

      optimizeAssets({
        assets: Object.entries(bundle).flatMap(([id, file]) =>
          file.type === "asset" && isCssFile(id)
            ? [
                {
                  id,
                  source: file.source,
                  write: (css: string) => {
                    file.source = css;
                  },
                },
              ]
            : [],
        ),
        optimizer,
        options: options ?? {},
        moduleTokens: moduleTokens.size,
        contentTokens: contentClasses.length,
        tokenNames: [...bundleTokenNames(bundle), ...contentTokens],
        log: logInfo,
        reportExtra: () =>
          usage?.report?.(optimizer.usage.prunedByProps, root) ?? [],
      });
    },
  };
  return plugin;
};
