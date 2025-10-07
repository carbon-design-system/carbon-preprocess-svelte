import type { Plugin } from "vite";
import { isCarbonSvelteImport, isCssFile } from "../utils.ts";
import type { OptimizeCssOptions } from "./create-optimized-css.ts";
import { createOptimizedCss } from "./create-optimized-css.ts";
import { printDiff } from "./print-diff.ts";

// Vite plugin (Rollup-compatible) to optimize CSS for Carbon Svelte components.
export const optimizeCss = (options?: OptimizeCssOptions): Plugin => {
  const verbose = options?.verbose !== false;
  const ids: string[] = [];

  return {
    name: "vite:carbon:optimize-css",
    apply: "build",
    enforce: "post",
    transform(_, id) {
      if (isCarbonSvelteImport(id)) {
        ids.push(id);
      }
    },
    async generateBundle(_, bundle) {
      // Skip processing if no Carbon Svelte imports are found.
      if (ids.length === 0) return;

      for (const id in bundle) {
        const file = bundle[id];

        if (file.type === "asset" && isCssFile(id)) {
          const original_css = file.source;
          const optimized_css = createOptimizedCss({
            ...options,
            source: original_css,
            ids,
          });

          file.source = optimized_css;

          if (verbose) {
            printDiff({ original_css, optimized_css, id });
          }
        }
      }
    },
  };
};
