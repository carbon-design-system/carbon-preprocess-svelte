import path from "node:path";
import postcss from "postcss";
import discardEmpty from "postcss-discard-empty";
import type { Plugin } from "vite";
import { components } from "./component-index";
import { CarbonSvelte, RE_EXT_CSS, RE_EXT_SVELTE } from "./constants";
import {
  log,
  percentageDiff,
  stringSizeInKB,
  toHumanReadableSize,
} from "./utils";

type OptimizeCssOptions = {
  /**
   * Set to `false` to disable verbose logging.
   * By default, the plugin will log the size diff
   * between the original and optimized CSS.
   * @default true
   */
  verbose?: boolean;

  /**
   * By default, the pre-compiled Carbon StyleSheet will
   * ship @font-face rules for all available IBM Plex fonts,
   * many of which are not used in the Carbon Svelte components.
   * As such, the default behavior is to only preserve IBM Plex fonts
   * with 400/600-weight and normal-style @font-face rules.
   *
   * Set to `true` to disable this behavior.
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
  const postcssPlugin = options?.postcssPlugin ?? (() => {});
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
            {
              postcssPlugin: "postcss-plugin:carbon:optimize-css",
              Rule(node) {
                const selector = node.selector;

                /**
                 * This could be improved.
                 * For now, first ensure that the selector contains a class.
                 */
                if (selector.includes(".")) {
                  /**
                   * Selectors may contain multiple classes, separated by a comma.
                   * For now, only extract classes.
                   */
                  const classes = selector
                    .split(",")
                    .filter((c) => c.trim().startsWith("."));

                  let remove_rule = true;

                  for (const name of classes) {
                    for (const selector of css_allowlist) {
                      /**
                       * If at least one class is in the allowlist, keep the rule.
                       * This is a simplistic approach and can be further optimized.
                       */
                      if (name.includes(selector)) {
                        remove_rule = false;
                        break;
                      }
                    }
                  }

                  if (remove_rule) {
                    node.remove();
                  }
                }
              },
              AtRule(node) {
                if (!preserveAllIBMFonts && node.name === "font-face") {
                  // IBM Plex Sans and IBM Plex Mono are the only fonts used in the Carbon Svelte components.
                  let is_IBM_Plex = false;

                  // 400/600 are the only weights used in the Carbon Svelte components.
                  let is_product_weight = false;

                  // Only normal-style fonts are used in the Carbon Svelte components.
                  let is_product_style = false;

                  node.walkDecls((decl) => {
                    switch (decl.prop) {
                      case "font-family":
                        is_IBM_Plex = /IBM Plex/.test(decl.value);
                        break;
                      case "font-style":
                        is_product_style = decl.value === "normal";
                        break;
                      case "font-weight":
                        is_product_weight =
                          decl.value === "400" || decl.value === "600";
                        break;
                    }
                  });

                  if (!(is_IBM_Plex && is_product_style && is_product_weight)) {
                    node.remove();
                  }
                }
              },
            },
            discardEmpty(),
            postcssPlugin,
          ]).process(file.source).css;

          const original_size = stringSizeInKB(file.source.toString());
          const optimized_size = stringSizeInKB(optimized_css);

          if (optimized_size < original_size) {
            file.source = optimized_css;

            if (!verbose) continue;

            const original = toHumanReadableSize(original_size);
            const optimized = toHumanReadableSize(optimized_size);
            const diff = percentageDiff(original_size, optimized_size);

            const { name, ext } = path.parse(id);

            log("\n");
            log("Optimized", name + ext);
            log("Before:", original);
            log(
              "After: ",
              optimized.padStart(original.length, " "),
              `(-${diff})\n`
            );
          }
        }
      }
    },
  };
};
