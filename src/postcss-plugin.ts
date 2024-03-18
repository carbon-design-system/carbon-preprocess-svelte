import type { Plugin } from "postcss";
import type { OptimizeCssOptions } from "./optimize-css";

type PostcssOptimizeCarbonOptions = Pick<
  OptimizeCssOptions,
  "preserveAllIBMFonts"
> & {
  css_allowlist: string[];
};

export function postcssOptimizeCarbon(
  options: PostcssOptimizeCarbonOptions,
): Plugin {
  const { preserveAllIBMFonts, css_allowlist } = options;

  return {
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
              is_product_weight = decl.value === "400" || decl.value === "600";
              break;
          }
        });

        if (!(is_IBM_Plex && is_product_style && is_product_weight)) {
          node.remove();
        }
      }
    },
  };
}
