import type { Plugin } from "vite";
import { isCarbonSvelteImport, isCssFile } from "../utils";
import { compareDiff } from "./compare-diff";
import type { OptimizeCssOptions } from "./create-optimized-css";
import { createOptimizedCss } from "./create-optimized-css";

export const optimizeCss = (options?: OptimizeCssOptions): Plugin => {
  const verbose = options?.verbose !== false;
  const preserveAllIBMFonts = options?.preserveAllIBMFonts === true;
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
          const optimized_css = createOptimizedCss(original_css, {
            preserveAllIBMFonts,
            ids,
          });

          file.source = optimized_css;

          if (verbose) {
            compareDiff({ original_css, optimized_css, id });
          }
        }
      }
    },
  };
};
