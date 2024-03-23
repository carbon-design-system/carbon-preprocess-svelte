import path from "node:path";
import postcss from "postcss";
import discardEmpty from "postcss-discard-empty";
import { components } from "../component-index";

export type OptimizeCssOptions = {
  /**
   * By default, the plugin will print the size
   * difference between the original and optimized CSS.
   *
   * Set to `false` to disable verbose logging.
   * @default true
   */
  verbose?: boolean;

  /**
   * By default, pre-compiled Carbon StyleSheets ship `@font-face` rules
   * for all available IBM Plex fonts, many of which are not actually
   * used in Carbon Svelte components.
   *
   * The recommended optimization is to only preserve:
   * - IBM Plex Sans (300/400/600-weight and normal-font-style rules)
   * - IBM Plex Mono (400-weight and normal-font-style rules)
   *
   * Set to `true` to disable this behavior and
   * retain *all* IBM Plex `@font-face` rules.
   * @default false
   */
  preserveAllIBMFonts?: boolean;
};

export function createOptimizedCss(
  original_css: Uint8Array | string,
  ids: string[],
  options?: OptimizeCssOptions
) {
  const preserveAllIBMFonts = options?.preserveAllIBMFonts === true;

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
          const attributes = {
            "font-family": "",
            "font-style": "",
            "font-weight": "",
          };

          node.walkDecls((decl) => {
            switch (decl.prop) {
              case "font-family":
                attributes["font-family"] = decl.value;
                break;
              case "font-style":
                attributes["font-style"] = decl.value;
                break;
              case "font-weight":
                attributes["font-weight"] = decl.value;
                break;
            }
          });

          const is_mono =
            attributes["font-style"] === "normal" &&
            attributes["font-family"] === "IBM Plex Mono" &&
            attributes["font-weight"] === "400";

          const is_sans =
            attributes["font-style"] === "normal" &&
            attributes["font-family"] === "IBM Plex Sans" &&
            ["300", "400", "600"].includes(attributes["font-weight"]);

          if (!(is_sans || is_mono)) {
            node.remove();
          }
        }
      },
    },
    discardEmpty(),
  ]).process(original_css).css;
}
