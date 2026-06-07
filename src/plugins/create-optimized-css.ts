import path from "node:path";
import type { AcceptedPlugin } from "postcss";
import postcss from "postcss";
import discardEmpty from "postcss-discard-empty";
import { components } from "../component-index";
import { ALWAYS_ON_CLASSES, CARBON_PREFIX } from "../constants";
import {
  optimizeStrictAtRule,
  optimizeStrictRule,
} from "./strict-css-optimizer";

export type OptimizeCssOptions = {
  /**
   * Set to `true` to suppress the size difference
   * logging between original and optimized CSS.
   * @default false
   */
  silent?: boolean;

  /**
   * Set to `false` to disable verbose logging.
   * @default true
   * @deprecated Use `silent` instead.
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

  experimental?: {
    /**
     * Enables stricter CSS tree-shaking. Compared to the default baseline,
     * this can drastically reduce output size depending on which Carbon
     * components you import — especially for small bundles that only use a
     * handful of components.
     *
     * Improvements over the default matcher:
     * - Prunes individual selectors from comma-separated lists instead of
     *   keeping the entire rule when any selector matches
     * - Requires every Carbon class in a multi-class selector to match the
     *   allowlist (descendants and same-element compounds), so importing
     *   NumberInput no longer pulls in `.bx--modal .bx--number` context rules
     *   and Button no longer pulls in Tabs skeleton styles via `.bx--skeleton`
     * - Drops flatpickr and legacy single-hyphen `bx-` rules unless
     *   DatePicker (or similar) is in the bundle
     * - Uses parenthesis-aware selector parsing for `:is()` and similar
     *
     * @default false
     */
    strict?: boolean;
  };
};

/**
 * Resolves the `silent` / `verbose` options into a single boolean.
 * `silent` takes precedence when provided; otherwise falls back
 * to inverting `verbose` (which defaults to `true`).
 */
export function isSilent(options?: OptimizeCssOptions): boolean {
  if (options?.silent !== undefined) return options.silent;
  return options?.verbose === false;
}

function isStrict(options?: OptimizeCssOptions): boolean {
  return options?.experimental?.strict === true;
}

type CreateOptimizedCssOptions = OptimizeCssOptions & {
  source: Uint8Array | string;
  ids: Iterable<string>;
  /** PostCSS `from` option. Pass asset/chunk path when available, or omit for `undefined`. */
  from?: string | undefined;
};

/**
 * Build the class allowlist from bundled component paths and whether flatpickr
 * CSS should stay (any DatePicker import).
 *
 * Paths like "Button.svelte" map through component-index to `.bx--*` classes.
 * `.bx--body` is always kept; apps set it on `<body>` but no component file
 * references it.
 */
function buildUsage(ids: Iterable<string>): {
  allowlist: Set<string>;
  preserveFlatpickr: boolean;
} {
  const allowlist = new Set(ALWAYS_ON_CLASSES);
  let preserveFlatpickr = false;

  for (const id of ids) {
    const { name } = path.parse(id);

    if (name === "DatePicker") {
      preserveFlatpickr = true;
    }

    if (name in components) {
      for (const cls of components[name].classes) {
        allowlist.add(cls);
      }
    }
  }

  return { allowlist, preserveFlatpickr };
}

function shouldKeepRule(selectors: string[], allowlist: Set<string>): boolean {
  for (const name of selectors) {
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
  preserveFlatpickr: boolean,
  strict: boolean,
  report: { removed: number },
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
        if (!strict) {
          const selector = node.selector;

          if (CARBON_PREFIX.test(selector)) {
            const selectors = selector.split(",").filter((selectee) => {
              const value = selectee.trim() ?? "";
              const [, rest] = value.split(".");
              return Boolean(rest);
            });

            if (!shouldKeepRule(selectors, allowlist)) {
              node.remove();
              report.removed++;
            }
          }
          return;
        }

        report.removed += optimizeStrictRule(node, {
          allowlist,
          preserveFlatpickr,
        });
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
        if (strict) {
          report.removed += optimizeStrictAtRule(node, { preserveFlatpickr });
          if (!node.parent) return;
        }

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
            report.removed++;
          }
        }
      },
    },
    discardEmpty(),
  ];
}

/**
 * The optimized CSS plus a count of how many Carbon rules/selectors/font-faces
 * were removed. Callers use `removed` to suppress the size diff log when nothing
 * was actually pruned (a size change alone can be misleading — e.g. PostCSS
 * re-serialization on a stylesheet with no Carbon styles to remove).
 */
export type OptimizedCssReport = {
  css: string;
  removed: number;
};

export function optimizeCssWithReport(
  options: CreateOptimizedCssOptions,
): OptimizedCssReport {
  const { source, ids } = options;
  const preserveAllIBMFonts = options?.preserveAllIBMFonts === true;
  const strict = isStrict(options);
  const { allowlist, preserveFlatpickr } = buildUsage(ids);
  const report = { removed: 0 };

  const { css } = postcss(
    createPostcssPlugins(
      allowlist,
      preserveAllIBMFonts,
      preserveFlatpickr,
      strict,
      report,
    ),
  ).process(source, { from: options.from });

  return { css, removed: report.removed };
}

export async function optimizeCssWithReportAsync(
  options: CreateOptimizedCssOptions,
): Promise<OptimizedCssReport> {
  const { source, ids } = options;
  const preserveAllIBMFonts = options?.preserveAllIBMFonts === true;
  const strict = isStrict(options);
  const { allowlist, preserveFlatpickr } = buildUsage(ids);
  const report = { removed: 0 };

  const { css } = await postcss(
    createPostcssPlugins(
      allowlist,
      preserveAllIBMFonts,
      preserveFlatpickr,
      strict,
      report,
    ),
  ).process(source, { from: options.from });

  return { css, removed: report.removed };
}

export function createOptimizedCss(options: CreateOptimizedCssOptions): string {
  return optimizeCssWithReport(options).css;
}

export async function createOptimizedCssAsync(
  options: CreateOptimizedCssOptions,
): Promise<string> {
  return (await optimizeCssWithReportAsync(options)).css;
}
