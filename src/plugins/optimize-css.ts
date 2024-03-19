import postcss from "postcss";
import discardEmpty from "postcss-discard-empty";
import type { Plugin } from "vite";
import { isCssFile } from "../utils";
import { compareDiff } from "./compare-diff";
import type { OptimizeCssOptions } from "./utils";
import { isCarbonSvelteComponent, postcssOptimizeCarbon } from "./utils";

export const optimizeCss = (options?: OptimizeCssOptions): Plugin => {
  const verbose = options?.verbose !== false;
  const preserveAllIBMFonts = options?.preserveAllIBMFonts === true;
  const ids: string[] = [];

  return {
    name: "vite:carbon:optimize-css",
    apply: "build",
    enforce: "post",
    transform(_, id) {
      if (isCarbonSvelteComponent(id)) {
        ids.push(id);
      }
    },
    async generateBundle(_, bundle) {
      if (ids.length === 0) return;

      for (const id in bundle) {
        const file = bundle[id];

        if (file.type === "asset" && isCssFile(id)) {
          const original_css = file.source;
          const optimized_css = postcss([
            postcssOptimizeCarbon({ preserveAllIBMFonts, ids }),
            discardEmpty(),
          ]).process(original_css).css;

          file.source = optimized_css;

          if (verbose) {
            compareDiff({ original_css, optimized_css, id });
          }
        }
      }
    },
  };
};
