import type { Plugin, Rollup } from "vite";
import type { ComponentIndex } from "../indexer/build-index";
import { loadComponentIndex } from "../indexer/load-index";
import {
  isCarbonSvelteImport,
  isCssFile,
  isScannableModule,
  toCssString,
} from "../utils";
import { createCssOptimizer } from "./create-optimized-css";
import { contentScanWarning, NO_CARBON_IMPORTS } from "./messages";
import { optimizeAssets } from "./optimize-assets";
import type { OptimizeCssOptions } from "./options";
import { collectCarbonTokens, scanContent } from "./scan-content";
import { hasOptimizableCss } from "./strict-css-optimizer";

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
export const optimizeCss = (options?: OptimizeCssOptions): Plugin => {
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
  /** Literal `bx--` classes in each scanned module, kept per module like `ids`. */
  const moduleClasses = new Map<string, Set<string>>();
  /** The installed Carbon's index; `undefined` leaves CSS unpruned. */
  let components: ComponentIndex | undefined;

  return {
    name: "vite:carbon:optimize-css",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      root = config.root;
      // Not `this.info`: it prefixes the plugin name and is absent on Rollup 2.
      logInfo = (message) => config.logger.info(message);
    },
    /**
     * Re-reads `content` on `--watch` rebuilds (the plugin instance is
     * reused) and loads the component index while modules transform.
     */
    async buildStart() {
      contentClasses = undefined;
      components = await loadComponentIndex(root);
    },
    transform(code, id) {
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
    generateBundle(_, bundle) {
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
      }

      const optimizer = createCssOptimizer({
        ...options,
        components,
        ids,
        contentClasses: [...contentClasses, ...moduleTokens],
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
        log: logInfo,
      });
    },
  };
};
