import path from "node:path";
import type { Plugin } from "postcss";
import { components } from "../component-index";
import { BITS_DENOM, CarbonSvelte, RE_EXT_SVELTE } from "../constants";

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

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function toHumanReadableSize(size_in_kb: number) {
  if (size_in_kb >= BITS_DENOM) {
    return formatter.format(size_in_kb / BITS_DENOM) + " MB";
  }

  return formatter.format(size_in_kb) + " kB";
}

export function percentageDiff(a: number, b: number) {
  return formatter.format(((a - b) / a) * 100) + "%";
}

export function stringSizeInKB(str: string) {
  const blob = new Blob([str], { type: "text/plain" });
  return blob.size / BITS_DENOM;
}

function padIfNeeded(a: string, b: string) {
  return a.length > b.length ? a : a.padStart(b.length, " ");
}

export function logComparison(props: {
  original_size: number;
  optimized_size: number;
  id: string;
}) {
  const { original_size, optimized_size, id } = props;
  const original = toHumanReadableSize(original_size);
  const optimized = toHumanReadableSize(optimized_size);
  const original_display = padIfNeeded(original, optimized);
  const optimized_display = padIfNeeded(optimized, original);
  const diff = percentageDiff(original_size, optimized_size);

  console.log("\n");
  console.log("Optimized", id);
  console.log("Before:", original_display);
  console.log("After: ", optimized_display, `(-${diff})\n`);
}

export function isCarbonSvelteComponent(id: string) {
  return RE_EXT_SVELTE.test(id) && id.includes(CarbonSvelte.Components);
}

export function getComponentClasses(id: string) {
  const { name } = path.parse(id);

  if (name in components) {
    return [...components[name].classes];
  }

  return [];
}

export function getCssAllowlist() {
  // `.bx--body` needs to be explicitly included,
  // or the class will be inadvertently removed.
  return [".bx--body"].slice();
}

type PostcssOptimizeCarbonOptions = OptimizeCssOptions & {
  css_allowlist: ReturnType<typeof getCssAllowlist>;
};

export function postcssOptimizeCarbon(
  options: PostcssOptimizeCarbonOptions,
): Plugin {
  const { preserveAllIBMFonts, css_allowlist } = options;

  return {
    postcssPlugin: "postcss-plugin:carbon:optimize-css",
    Rule(node) {
      const selector = node.selector;

      // Ensure that the selector contains a class.
      if (selector.includes(".")) {
        // Selectors may contain multiple classes, separated by a comma.
        const classes = selector
          .split(",")
          .filter((c) => c.trim().startsWith("."));

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
