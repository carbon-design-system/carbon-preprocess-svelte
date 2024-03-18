import postcss from "postcss";
import discardEmpty from "postcss-discard-empty";
import type { Plugin } from "vite";
import { RE_EXT_CSS } from "../constants";
import type { OptimizeCssOptions } from "./utils";
import {
  getComponentClasses,
  getCssAllowlist,
  isCarbonSvelteComponent,
  logComparison,
  postcssOptimizeCarbon,
  stringSizeInKB,
} from "./utils";

export const optimizeCss = (options?: OptimizeCssOptions): Plugin => {
  const verbose = options?.verbose !== false;
  const preserveAllIBMFonts = options?.preserveAllIBMFonts === true;
  const css_allowlist = getCssAllowlist();

  return {
    name: "vite:carbon:optimize-css",
    apply: "build",
    enforce: "post",
    transform(_, id) {
      if (isCarbonSvelteComponent(id)) {
        css_allowlist.push(...getComponentClasses(id));
      }
    },
    async generateBundle(_, bundle) {
      for (const id in bundle) {
        const file = bundle[id];

        if (file.type === "asset" && RE_EXT_CSS.test(id)) {
          const optimized_css = postcss([
            postcssOptimizeCarbon({ preserveAllIBMFonts, css_allowlist }),
            discardEmpty(),
          ]).process(file.source).css;

          const original_size = stringSizeInKB(file.source.toString());
          const optimized_size = stringSizeInKB(optimized_css);

          if (optimized_size < original_size) {
            file.source = optimized_css;

            if (verbose) {
              logComparison({ original_size, optimized_size, id });
            }
          }
        }
      }
    },
  };
};
