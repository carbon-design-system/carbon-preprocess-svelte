import postcss from "postcss";
import discardEmpty from "postcss-discard-empty";
import type { Plugin } from "vite";
import { RE_EXT_CSS } from "../constants";
import type { OptimizeCssOptions } from "./utils";
import {
  isCarbonSvelteComponent,
  logComparison,
  postcssOptimizeCarbon,
} from "./utils";

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

        if (file.type === "asset" && RE_EXT_CSS.test(id)) {
          const original_css = file.source;
          const optimized_css = postcss([
            postcssOptimizeCarbon({ preserveAllIBMFonts, ids }),
            discardEmpty(),
          ]).process(original_css).css;

          file.source = optimized_css;

          if (verbose) {
            logComparison({ original_css, optimized_css, id });
          }
        }
      }
    },
  };
};
