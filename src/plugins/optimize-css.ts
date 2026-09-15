import type { Plugin } from "vite";
import { setComponents } from "../component-index-registry";
import { ensureLiveComponentIndex } from "../indexer/live-index";
import { isCarbonSvelteImport, isCssFile, isScannableModule } from "../utils";
import type { OptimizeCssOptions } from "./create-optimized-css";
import { createCssOptimizer, isSilent } from "./create-optimized-css";
import {
  contentGlobFailed,
  contentMatchedNothing,
  NO_CARBON_IMPORTS,
} from "./messages";
import { printDiff } from "./print-diff";
import type { AssetReport } from "./print-report";
import { printReport } from "./print-report";
import { collectCarbonTokens, scanContent } from "./scan-content";

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
   * Set of absolute file paths to Carbon Svelte components used in the app.
   * Populated during the transform phase, consumed during generateBundle.
   */
  const ids = new Set<string>();
  let root = process.cwd();
  /** Classes from `content` globs. Cached after first scan. */
  let contentClasses: string[] | undefined;
  /** Literal `bx--` classes found while scanning bundled module code. */
  const moduleClasses = new Set<string>();

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
    },
    /**
     * Runs once before any module is transformed. Resets state tracked from
     * a prior build so `vite build --watch` rebuilds (which reuse this same
     * plugin instance) don't leak component ids or a stale content scan into
     * the next build. When `experimental.liveIndex` is set, this is also
     * where the component index gets rebuilt from the project's installed
     * `carbon-components-svelte` (or read from cache), so it's ready before
     * `transform`/`generateBundle` ever consult it.
     */
    async buildStart() {
      ids.clear();
      contentClasses = undefined;
      moduleClasses.clear();

      if (options?.experimental?.liveIndex) {
        setComponents(await ensureLiveComponentIndex());
      }
    },
    /**
     * The transform hook is called for every module in the build graph.
     * We don't modify the code here—we just track which Carbon components
     * are imported so we know which CSS classes to preserve later.
     */
    transform(code, id) {
      if (isCarbonSvelteImport(id)) {
        ids.add(id);
        return;
      }
      if (options?.scanModules !== false && isScannableModule(id)) {
        collectCarbonTokens(code, moduleClasses);
      }
    },
    /**
     * generateBundle runs after all chunks and assets have been created.
     * We iterate through CSS assets and run PostCSS to remove unused rules.
     * Mutating `file.source` directly updates the bundle output in-place.
     */
    async generateBundle(_, bundle) {
      // Skip processing if no Carbon Svelte imports are found; that's
      // almost always a misconfiguration, so warn unless silenced.
      if (ids.size === 0) {
        if (!silent) this.warn(NO_CARBON_IMPORTS);
        return;
      }

      if (contentClasses === undefined) {
        const scan = scanContent(options?.content, root);

        if (!silent && options?.content && options.content.length > 0) {
          if (scan.error !== undefined) {
            this.warn(contentGlobFailed(options.content, root, scan.error));
          } else if (scan.matchedFiles === 0) {
            this.warn(contentMatchedNothing(options.content, root));
          }
        }

        contentClasses = scan.classes;
      }

      const optimizer = createCssOptimizer({
        ...options,
        ids,
        contentClasses: [...contentClasses, ...moduleClasses],
      });
      const assetReports: AssetReport[] = [];

      for (const id in bundle) {
        const file = bundle[id];

        if (file.type === "asset" && isCssFile(id)) {
          const original_css = file.source;
          const { css: optimized_css, removed } = optimizer.run(
            original_css,
            id,
          );

          if (!options?.dryRun) {
            file.source = optimized_css;
          }

          if (!silent && removed > 0) {
            if (options?.dryRun) {
              console.log(`Dry run: ${id} left unchanged`);
            }
            printDiff({ original_css, optimized_css, id });
          }

          if (options?.report) {
            assetReports.push({
              id,
              removed,
              beforeBytes:
                typeof original_css === "string"
                  ? Buffer.byteLength(original_css)
                  : original_css.byteLength,
              afterBytes: Buffer.byteLength(optimized_css),
            });
          }
        }
      }

      if (options?.report) {
        printReport({
          components: optimizer.usage.components,
          allowlistSize: optimizer.usage.allowlistSize,
          moduleTokens: moduleClasses.size,
          contentTokens: contentClasses.length,
          safelistEntries: options.safelist?.length ?? 0,
          assets: assetReports,
          dryRun: options.dryRun,
        });
      }
    },
  };
};
