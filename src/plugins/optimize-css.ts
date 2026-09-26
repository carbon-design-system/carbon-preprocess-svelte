import { isBuiltin } from "node:module";
import type { Plugin, Rollup } from "vite";
import type { ComponentIndex } from "../indexer/build-index";
import { loadComponentIndex } from "../indexer/load-index";
import { isCarbonSvelteImport, isCssFile, isScannableModule } from "../utils";
import type { OptimizeCssOptions } from "./create-optimized-css";
import {
  createCssOptimizer,
  isSilent,
  toCssString,
} from "./create-optimized-css";
import { contentScanWarning, NO_CARBON_IMPORTS } from "./messages";
import { logAssetDiff } from "./print-diff";
import type { AssetReport } from "./print-report";
import { printReport, toAssetReport } from "./print-report";
import { collectCarbonTokens, scanContent } from "./scan-content";
import {
  carbonSourceDir,
  createModulePropScanner,
  createPropUsage,
  type ModulePropScanner,
  markAllDynamic,
  mergePropUsage,
  type PropUsage,
} from "./scan-props";
import { hasOptimizableCss } from "./strict-css-optimizer";

/** True if any emitted CSS asset has Carbon rules the optimizer can prune. */
function hasCarbonCss(bundle: Rollup.OutputBundle): boolean {
  for (const id in bundle) {
    const file = bundle[id];
    if (
      file.type === "asset" &&
      isCssFile(id) &&
      hasOptimizableCss(toCssString(file.source))
    ) {
      return true;
    }
  }
  return false;
}

type ModuleGraphContext = {
  getModuleInfo?: (id: string) => {
    importedIds: readonly string[];
    dynamicallyImportedIds: readonly string[];
    /** `null` for an external (and, in Rolldown, the only sign of one). */
    code?: string | null;
    /** Rollup only. */
    isExternal?: boolean;
  } | null;
};

/**
 * Whether the build leaves any import external, other than a Node
 * built-in. Both Rollup and Rolldown list externals in `getModuleIds()`;
 * Rollup flags them `isExternal`, Rolldown only leaves `code` `null`. An
 * imported id with no module info at all counts as external too.
 */
function hasExternalImport(
  context: ModuleGraphContext,
  graph: ReadonlySet<string>,
): boolean {
  if (!context.getModuleInfo) return false;
  const isExternal = (id: string) => {
    if (isBuiltin(id)) return false;
    const info = context.getModuleInfo?.(id);
    return !info || info.isExternal === true || info.code === null;
  };

  for (const id of graph) {
    if (isExternal(id)) return true;
    const info = context.getModuleInfo(id);
    for (const imported of info?.importedIds ?? []) {
      if (isExternal(imported)) return true;
    }
    for (const imported of info?.dynamicallyImportedIds ?? []) {
      if (isExternal(imported)) return true;
    }
  }

  return false;
}

/**
 * Vite/Rollup plugin that removes unused Carbon CSS classes from production builds.
 *
 * Unlike the Webpack plugin which uses module dependency tracking, this plugin
 * collects component IDs during the `transform` hook as modules are processed.
 * The actual CSS optimization happens in `generateBundle` after all modules
 * have been transformed and the bundle structure is finalized.
 *
 * The plugin is configured with `apply: "build"` and `enforce: "post"` to ensure:
 * - It only runs during production builds (not dev server)
 * - It runs after other plugins have finished transforming modules
 */
export const optimizeCss = (options?: OptimizeCssOptions): Plugin => {
  const silent = isSilent(options);
  /**
   * Absolute file paths of Carbon Svelte components seen by `transform`, in
   * this build or an earlier `vite build --watch` build. Not cleared per
   * build: on a rebuild Rollup serves unchanged modules from its cache
   * without calling `transform`, so only the ids still in the module graph
   * (`this.getModuleIds()`) count at `generateBundle`.
   */
  const ids = new Set<string>();
  let root = process.cwd();
  /**
   * Set by `configResolved`, which only Vite calls. Plain Rollup and
   * Rolldown never call it, so this stays `undefined` and `printDiff`
   * writes to the console instead. Rollup's CLI writes plugin logs to
   * stderr, which would move the size block off stdout.
   */
  let logInfo: ((message: string) => void) | undefined;
  /** Classes from `content` globs. Cached after first scan. */
  let contentClasses: string[] | undefined;
  /**
   * Literal `bx--` classes found in each scanned module's code, keyed by
   * module id. Per module for the same reason as `ids`: a cached module
   * keeps its last scan, and a re-transformed one replaces it.
   */
  const moduleClasses = new Map<string, Set<string>>();
  /**
   * What each module passes to the index's variant props (`kind: "ghost"`),
   * keyed by module id. Per module for the same reason as `ids`.
   */
  const propUsage = new Map<string, PropUsage>();
  /** Set by `buildStart` unless `scanModules: false` or nothing to scan for. */
  let scanProps: ModulePropScanner | undefined;
  /** The installed Carbon's index; `undefined` leaves CSS unpruned. */
  let components: ComponentIndex | undefined;

  return {
    name: "vite:carbon:optimize-css",
    apply: "build",
    enforce: "post",
    /**
     * Vite calls this with the resolved project root; plain Rollup never
     * calls it, so `root` stays at `process.cwd()`.
     */
    configResolved(config) {
      root = config.root;
      // Not `this.info`: it prefixes the plugin name, is absent on Rollup 2
      // contexts, and writes to stderr under the Rollup CLI.
      logInfo = (message) => config.logger.info(message);
    },
    /**
     * Runs once before any module is transformed. Resets the content scan
     * so `vite build --watch` rebuilds (which reuse this same plugin
     * instance) re-read `content` files from disk. `ids` and
     * `moduleClasses` are kept; `generateBundle` drops modules that left the
     * graph. Also loads the component index for the project's installed
     * `carbon-components-svelte` (built once, then read from cache), so it's
     * ready before `generateBundle` consults it. If it can't be built, this
     * build's CSS is left unpruned.
     */
    async buildStart() {
      contentClasses = undefined;
      components = await loadComponentIndex(root);
      // Narrowing variants needs every module scanned: without the scan,
      // no prop usage reaches the optimizer and every variant is kept.
      scanProps =
        options?.scanModules !== false && components
          ? createModulePropScanner(components, carbonSourceDir(root))
          : undefined;
    },
    /**
     * The transform hook is called for every module in the build graph.
     * We don't modify the code here—we just track which Carbon components
     * are imported so we know which CSS classes to preserve later.
     */
    transform(code, id) {
      if (scanProps) {
        const usage = scanProps(id, code);
        if (usage) propUsage.set(id, usage);
        else propUsage.delete(id);
      }
      if (isCarbonSvelteImport(id)) {
        ids.add(id);
        return;
      }
      if (options?.scanModules !== false && isScannableModule(id)) {
        const tokens = new Set<string>();
        collectCarbonTokens(code, tokens);
        // Replace, don't merge: an edit that removes a class must drop it.
        if (tokens.size > 0) moduleClasses.set(id, tokens);
        else moduleClasses.delete(id);
      }
    },
    /**
     * generateBundle runs after all chunks and assets have been created.
     * Splices unused Carbon rules out of CSS assets. Mutating
     * `file.source` updates the bundle output in place.
     */
    async generateBundle(_, bundle) {
      // Already warned by `loadComponentIndex`.
      if (!components) return;

      // Includes modules served from Rollup's cache. Absent on the bare
      // contexts unit tests pass, where everything collected counts.
      const graph = this.getModuleIds
        ? new Set(this.getModuleIds())
        : undefined;
      if (graph) {
        // Forget modules the app no longer bundles, so a removed component
        // or class stops keeping CSS alive.
        for (const id of ids) if (!graph.has(id)) ids.delete(id);
        for (const id of moduleClasses.keys()) {
          if (!graph.has(id)) moduleClasses.delete(id);
        }
        for (const id of propUsage.keys()) {
          if (!graph.has(id)) propUsage.delete(id);
        }
      }
      const moduleTokens = new Set<string>();
      for (const tokens of moduleClasses.values()) {
        for (const token of tokens) moduleTokens.add(token);
      }

      if (ids.size === 0) {
        // Warn only when this build emitted Carbon CSS. A secondary build
        // that never imports Carbon has nothing to prune.
        if (!silent && hasCarbonCss(bundle)) this.warn(NO_CARBON_IMPORTS);
        return;
      }

      if (contentClasses === undefined) {
        const scan = scanContent(options?.content, root);
        const warning = contentScanWarning(options?.content, root, scan);
        if (!silent && warning) this.warn(warning);
        contentClasses = scan.classes;
      }

      let usage: PropUsage | undefined;
      if (scanProps) {
        usage = createPropUsage();
        for (const moduleUsage of propUsage.values()) {
          mergePropUsage(usage, moduleUsage);
        }
        // An external module (a dependency an SSR build leaves to Node, a
        // CDN global) is imported but never transformed, so its code could
        // pass a literal nothing recorded.
        if (graph && hasExternalImport(this, graph)) {
          markAllDynamic(usage, components);
        }
      }

      const optimizer = createCssOptimizer({
        ...options,
        components,
        ids,
        contentClasses: [...contentClasses, ...moduleTokens],
        propUsage: usage,
      });
      const assetReports: AssetReport[] = [];

      for (const id in bundle) {
        const file = bundle[id];

        if (file.type === "asset" && isCssFile(id)) {
          const original_css = file.source;
          const { css: optimized_css, removed } = optimizer.run(original_css);

          if (!options?.dryRun) {
            file.source = optimized_css;
          }

          if (!silent && removed > 0) {
            logAssetDiff({
              original_css,
              optimized_css,
              id,
              dryRun: options?.dryRun,
              log: logInfo,
            });
          }

          if (options?.report) {
            assetReports.push(
              toAssetReport(id, original_css, optimized_css, removed),
            );
          }
        }
      }

      if (options?.report) {
        printReport({
          components: optimizer.usage.components,
          allowlistSize: optimizer.usage.allowlistSize,
          variants: optimizer.usage.variants,
          gatedOff: optimizer.usage.gatedOff,
          moduleTokens: moduleTokens.size,
          contentTokens: contentClasses.length,
          safelistEntries: options.safelist?.length ?? 0,
          assets: assetReports,
          dryRun: options.dryRun,
        });
      }
    },
  };
};
