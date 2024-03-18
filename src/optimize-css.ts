import path from "node:path";
import postcss from "postcss";
import discardEmpty from "postcss-discard-empty";
import type { Plugin } from "vite";
import { components } from "./component-index";
import { CarbonSvelte, RE_EXT_CSS, RE_EXT_SVELTE } from "./constants";
import { postcssOptimizeCarbon } from "./postcss-plugin";
import { logComparison, stringSizeInKB } from "./utils";

export type OptimizeCssOptions = {
  /**
   * By default, the plugin will log the size diff
   * between the original and optimized CSS.
   *
   * Set to `false` to disable verbose logging.
   * @default true
   */
  verbose?: boolean;

  /**
   * By default, pre-compiled Carbon StyleSheets ship `@font-face`
   * rules for all available IBM Plex fonts, many of which are
   * not actually used in Carbon Svelte components.
   *
   * The recommended optimization is to only preserve IBM Plex
   * fonts with 400/600-weight and normal-font-style rules.
   *
   * Set to `true` to disable this behavior.
   * @default false
   */
  preserveAllIBMFonts?: boolean;
};

export const optimizeCss = (options?: OptimizeCssOptions): Plugin => {
  const verbose = options?.verbose !== false;
  const preserveAllIBMFonts = options?.preserveAllIBMFonts === true;
  const css_allowlist: string[] = [".bx--body"];

  return {
    name: "vite:carbon:optimize-css",
    apply: "build",
    enforce: "post",
    transform(_, id) {
      // Append Carbon Svelte component classes to the allowlist.
      if (RE_EXT_SVELTE.test(id) && id.includes(CarbonSvelte.Components)) {
        const { name } = path.parse(id);

        if (name in components) {
          css_allowlist.push(...components[name].classes);
        }
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

            if (verbose) logComparison({ original_size, optimized_size, id });
          }
        }
      }
    },
  };
};
