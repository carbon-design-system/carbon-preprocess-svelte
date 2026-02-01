import type { Plugin } from "vite";
import { isCarbonSvelteImport, isCssFile } from "../utils";
import type { OptimizeCssOptions } from "./create-optimized-css";
import { createOptimizedCss } from "./create-optimized-css";
import { printDiff } from "./print-diff";

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
  const verbose = options?.verbose !== false;
  /**
   * Set of absolute file paths to Carbon Svelte components used in the app.
   * Populated during the transform phase, consumed during generateBundle.
   */
  const ids = new Set<string>();

  return {
    name: "vite:carbon:optimize-css",
    apply: "build",
    enforce: "post",
    /**
     * The transform hook is called for every module in the build graph.
     * We don't modify the code here—we just track which Carbon components
     * are imported so we know which CSS classes to preserve later.
     */
    transform(_, id) {
      if (isCarbonSvelteImport(id)) {
        ids.add(id);
      }
    },
    /**
     * generateBundle runs after all chunks and assets have been created.
     * We iterate through CSS assets and run PostCSS to remove unused rules.
     * Mutating `file.source` directly updates the bundle output in-place.
     */
    async generateBundle(_, bundle) {
      // Skip processing if no Carbon Svelte imports are found.
      if (ids.size === 0) return;

      for (const id in bundle) {
        const file = bundle[id];

        if (file.type === "asset" && isCssFile(id)) {
          const original_css = file.source;
          const start = performance.now();
          const optimized_css = createOptimizedCss({
            ...options,
            source: original_css,
            ids,
          });
          const elapsed_ms = performance.now() - start;

          file.source = optimized_css;

          if (verbose) {
            printDiff({ original_css, optimized_css, id, elapsed_ms });
          }
        }
      }
    },
  };
};
