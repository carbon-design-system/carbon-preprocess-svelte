import path from "node:path";
import type { AcceptedPlugin } from "postcss";
import postcss from "postcss";
import discardEmpty from "postcss-discard-empty";
import { components } from "../component-index";
import { CARBON_PREFIX } from "../constants";

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
   * The default behavior is to preserve the following IBM Plex fonts:
   * - IBM Plex Sans (300/400/600-weight and normal-font-style rules)
   * - IBM Plex Mono (400-weight and normal-font-style rules)
   *
   * Set to `true` to disable this behavior and
   * retain *all* IBM Plex `@font-face` rules.
   * @default false
   */
  preserveAllIBMFonts?: boolean;
};

type CreateOptimizedCssOptions = OptimizeCssOptions & {
  source: Uint8Array | string;
  ids: Iterable<string>;
};

/**
 * Builds an allowlist of CSS class selectors that should be preserved.
 *
 * Takes a list of component file paths (e.g., "Button.svelte") and looks up
 * each component in the pre-generated component-index to find its associated
 * CSS classes. Returns a Set for O(1) lookups during CSS tree-shaking.
 *
 * The ".bx--body" class is always included since it's applied to the document
 * body by apps using Carbon, but isn't referenced in any component file.
 */
function buildAllowlist(ids: Iterable<string>): Set<string> {
  const allowlist = new Set([".bx--body"]);

  for (const id of ids) {
    const { name } = path.parse(id);

    if (name in components) {
      for (const cls of components[name].classes) {
        allowlist.add(cls);
      }
    }
  }

  return allowlist;
}

/**
 * Determines whether a CSS rule should be preserved based on its selectors.
 *
 * Uses a two-tier matching strategy for performance:
 * 1. Fast path: O(1) exact match check against the allowlist Set
 * 2. Slow path: O(n) substring check for BEM-style class variations
 *
 * The substring check is necessary because Carbon uses BEM naming conventions
 * where a parent class like ".bx--btn" may have related selectors like
 * ".bx--btn--primary" or ".bx--btn__icon" that should also be preserved.
 */
function shouldKeepRule(classes: string[], allowlist: Set<string>): boolean {
  for (const name of classes) {
    if (allowlist.has(name)) return true;

    for (const selector of allowlist) {
      if (name.includes(selector)) return true;
    }
  }
  return false;
}

/**
 * Creates the PostCSS plugin pipeline for CSS optimization.
 *
 * The pipeline consists of two plugins:
 * 1. Custom Carbon optimizer - removes unused rules and font-faces
 * 2. postcss-discard-empty - cleans up any empty rule blocks left behind
 */
function createPostcssPlugins(
  allowlist: Set<string>,
  preserveAllIBMFonts: boolean,
): AcceptedPlugin[] {
  return [
    {
      postcssPlugin: "postcss-plugin:carbon:optimize-css",
      /**
       * Rule visitor that removes CSS rules for unused Carbon components.
       *
       * Only processes selectors containing the Carbon prefix (bx--) to avoid
       * accidentally removing non-Carbon styles. For multi-selector rules
       * (e.g., ".bx--btn, .bx--link"), each selector is checked individually.
       */
      Rule(node) {
        const selector = node.selector;

        if (CARBON_PREFIX.test(selector)) {
          /**
           * Parse comma-separated selectors, handling cases where Carbon classes
           * are prefixed with HTML tags for specificity (e.g., "a.bx--link").
           * The split on "." extracts the class portion after any tag prefix.
           */
          const classes = selector.split(",").filter((selectee) => {
            const value = selectee.trim() ?? "";
            const [, rest] = value.split(".");
            return Boolean(rest);
          });

          if (!shouldKeepRule(classes, allowlist)) {
            node.remove();
          }
        }
      },
      /**
       * AtRule visitor that removes unused IBM Plex @font-face declarations.
       *
       * Carbon's pre-compiled CSS includes @font-face rules for all IBM Plex
       * variants (weights, styles, languages), but most apps only need a subset.
       * By default, we preserve only the fonts actually used by Carbon components:
       * - IBM Plex Sans: weights 300/400/600 in normal style
       * - IBM Plex Mono: weight 400 in normal style (for code snippets)
       */
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
              case "font-style":
              case "font-weight":
                attributes[decl.prop] = decl.value;
                break;
            }
          });

          if (!attributes["font-family"].startsWith("IBM Plex")) {
            return;
          }

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
  ];
}

export function createOptimizedCss(options: CreateOptimizedCssOptions): string {
  const { source, ids } = options;
  const preserveAllIBMFonts = options?.preserveAllIBMFonts === true;
  const allowlist = buildAllowlist(ids);

  return postcss(createPostcssPlugins(allowlist, preserveAllIBMFonts)).process(
    source,
  ).css;
}

export async function createOptimizedCssAsync(
  options: CreateOptimizedCssOptions,
): Promise<string> {
  const { source, ids } = options;
  const preserveAllIBMFonts = options?.preserveAllIBMFonts === true;
  const allowlist = buildAllowlist(ids);

  const result = await postcss(
    createPostcssPlugins(allowlist, preserveAllIBMFonts),
  ).process(source);

  return result.css;
}
