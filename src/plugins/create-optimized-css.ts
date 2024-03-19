import path from "node:path";
import postcss from "postcss";
import discardEmpty from "postcss-discard-empty";
import { components } from "../component-index";

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

export function createOptimizedCss(
  original_css: Uint8Array | string,
  options: OptimizeCssOptions & { ids: string[] },
) {
  const { preserveAllIBMFonts, ids } = options;

  // List of Carbon classes that must be preserved in the CSS
  // but that are not referenced in Carbon Svelte components.
  const css_allowlist = [".bx--body"];

  for (const id of ids) {
    const { name } = path.parse(id);

    if (name in components) {
      css_allowlist.push(...components[name].classes);
    }
  }

  return postcss([
    {
      postcssPlugin: "postcss-plugin:carbon:optimize-css",
      Rule(node) {
        const selector = node.selector;

        // Ensure that the selector contains a class.
        if (selector.includes(".")) {
          // Selectors may contain multiple classes, separated by a comma.
          const classes = selector.split(",").filter((selectee) => {
            const value = selectee.trim() ?? "";
            // Some Carbon classes are prefixed with a tag for higher specificity.
            // E.g., a.bx--header
            const [, rest] = value.split(".");
            return Boolean(rest);
          });

          let remove_rule = true;

          for (const name of classes) {
            for (const selector of css_allowlist) {
              // If at least one class is in the allowlist, keep the rule.
              // This is a simplistic approach and can be further optimized.
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
          // IBM Plex Sans, IBM Plex Mono are the only fonts used in components.
          let is_IBM_Plex = false;

          // 400/600 are the only weights used in components.
          let is_product_weight = false;

          // Only normal-style fonts are used in components.
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
  ]).process(original_css).css;
}
