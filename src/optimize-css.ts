import path from "node:path";
import postcss from "postcss";
import discardEmpty from "postcss-discard-empty";
import type { Plugin } from "vite";
import { components } from "./component-index";
import { CarbonSvelte, RE_EXT_CSS, RE_EXT_SVELTE } from "./constants";
import { postcssOptimizeCarbon } from "./postcss-plugin";
import { logComparison, noop, stringSizeInKB } from "./utils";

export type OptimizeCssOptions = {
  /**
   * Set to `false` to disable verbose logging.
   * By default, the plugin will log the size diff
   * between the original and optimized CSS.
   * 
   * @default true
   */
  verbose?: boolean;

  /**
   * By default, pre-compiled Carbon StyleSheets  ship `@font-face`
   * rules for all available IBM Plex fonts, many of which are
   * not used in the Carbon Svelte components.
   * 
   * The recommended optimization is to only preserve IBM Plex fonts
   * with 400/600-weight and normal-font-style rules.
   *
   * Set to `true` to disable this behavior.
   * 
   * @default false
   */
  preserveAllIBMFonts?: boolean;

  /**
   * Optionally provide a custom PostCSS plugin.
   * This plugin will be applied after Carbon Svelte CSS is optimized.
   * This is exposed for convenience and maximum flexibility.
   * @see https://postcss.org/docs/postcss-plugins
   */
  postcssPlugin?: postcss.Plugin;
};

export const optimizeCss = (options?: OptimizeCssOptions): Plugin => {
  const verbose = options?.verbose !== false;
  const preserveAllIBMFonts = options?.preserveAllIBMFonts === true;
  const postcssPlugin = options?.postcssPlugin ?? noop;
  const css_allowlist: string[] = [".bx--body"];

  return {
    name: "vite:carbon:optimize-css",
    apply: "build",
    enforce: "post",
    transform(_, id) {
      /**
       * For all resolved modules that are Carbon Svelte components,
       * add the component's pre-indexed classes to the allowlist.
       */
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
            postcssPlugin,
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
