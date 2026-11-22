import type { UsageOptions } from "svelte-prune/internal/analysis";
import { LOG_PREFIX } from "../constants";
import type { FontDisplay } from "./font-display";
import type { SafelistEntry } from "./safelist";

export type OptimizeCssOptions = {
  /**
   * Set to `true` to suppress the size difference
   * logging between original and optimized CSS.
   * Under Vite the size log also follows `logLevel` and `customLogger`,
   * so `--logLevel warn` hides it without setting `silent`.
   * @default false
   */
  silent?: boolean;

  /**
   * Run the whole pipeline and print the size log, but leave every CSS
   * asset unchanged. Use it to preview the reduction and check the output
   * before enabling pruning in a production build.
   * @default false
   */
  dryRun?: boolean;

  /**
   * Print a per-build summary of what the plugin detected: the Carbon
   * components that can render, what it keeps (module scan, `content`,
   * `safelist`), each component's prop values, and per-asset results.
   * Independent of `silent`.
   * @default false
   */
  report?: boolean;

  /**
   * By default, pre-compiled Carbon StyleSheets ship `@font-face` rules
   * for all available IBM Plex fonts, many of which are not actually
   * used in Carbon Svelte components.
   *
   * The default behavior is to preserve the following IBM Plex fonts:
   * - IBM Plex Sans (300/400/600-weight rules; italic only if
   *   `<Text italic>` is used)
   * - IBM Plex Mono (400-weight and normal-font-style rules)
   *
   * Set to `true` to disable this behavior and
   * retain *all* IBM Plex `@font-face` rules.
   * @default false
   */
  preserveAllIBMFonts?: boolean;

  /**
   * The `font-display` of the IBM Plex `@font-face` rules the CSS keeps.
   * Carbon's stylesheets ship `auto`, which in most browsers hides text
   * for up to three seconds while the font loads from IBM's CDN; `swap`
   * shows it in a fallback font until then.
   * @default unchanged ("auto")
   */
  fontDisplay?: FontDisplay;

  /**
   * Class selectors to always keep, regardless of what renders. For
   * Carbon classes the analysis can't see:
   * - Hand-written Carbon classes in app markup (e.g. `<div class="bx--grid">`)
   * - Theme/layout utilities that no component file references
   *
   * Each entry is either:
   * - a `string`, matched literally as a complete class token. `.bx--grid`
   *   keeps `.bx--grid` and `.bx--grid:hover` but not `.bx--grid--wide`
   * - a `RegExp`, tested against the whole selector. `/^\.bx--btn--/` keeps
   *   every `.bx--btn--*` variant
   *
   * For ``class={`bx--btn--${x}`}``, a literal string entry is not enough.
   * Use a `RegExp` entry or the `content` option.
   *
   * @example
   * safelist: [".bx--grid", ".bx--aspect-ratio", /^\.bx--btn--/]
   */
  safelist?: Array<SafelistEntry>;

  /**
   * Glob patterns (relative to the project root: Vite `root`, webpack/Rspack
   * `context`, or the working directory under plain Rollup) of source files
   * to scan for literal `bx--`-prefixed tokens. Every token found is kept.
   * For ``class={`bx--btn--${kind}`}``, the prefix `bx--btn--` in source
   * keeps runtime variants like `.bx--btn--primary`.
   *
   * A pattern that matches no files raises a bundler warning naming the root
   * it was resolved from.
   *
   * @example
   * content: ["src/**\/*.{svelte,js,ts}"]
   */
  content?: string[];

  /**
   * Scan the code of every bundled module for literal `bx--` tokens and keep
   * them, so hand-written Carbon classes in your own markup
   * (`<div class="bx--grid">`) and prefix literals (`` `bx--btn--${kind}` ``)
   * survive without configuration. Carbon's own sources, CSS modules, and
   * virtual modules are skipped. Set to `false` to rely only on what the
   * components render, `safelist`, and `content`.
   * @default true
   */
  scanModules?: boolean;

  /**
   * Components that keep every variant's styles, as if rendered with any
   * props: for one whose props come from data the analysis can't read and
   * `assume` can't list, or to rule the analysis out when a style goes
   * missing.
   *
   * Carbon rules for prop values, slots and child components the app never
   * uses are pruned: with only `<Button kind="tertiary">`, the tertiary
   * styles stay and the other kinds, sizes, the skeleton and the icon-only
   * tooltip go. A prop the analysis can't read (a reassigned variable, a
   * spread, `bind:`) keeps every value, and a component used as a value,
   * or imported in a way the analysis can't read (a bundler alias), keeps
   * everything. If the analysis fails, CSS is left unpruned, with a warning.
   *
   * @example
   * exclude: ["DataTable"]
   */
  exclude?: readonly string[];

  /**
   * Values for props set from expressions the analysis can't read, by
   * component then prop. A value not listed loses its styles. Spreads
   * still keep everything.
   *
   * @example
   * assume: { Button: { kind: ["primary", "danger"] } }
   */
  assume?: Record<
    string,
    Record<string, Array<string | number | boolean | null>>
  >;
};

/**
 * Whether CSS can be pruned from `optimizeComponents`' analysis: only
 * without `exclude` or `assume`, which the rewrite doesn't read.
 */
export function sharesAnalysis(options?: OptimizeCssOptions): boolean {
  return (
    (options?.exclude ?? []).length === 0 &&
    Object.keys(options?.assume ?? {}).length === 0
  );
}

/** What the usage analysis reads the app with. */
export function usageOptions(options?: OptimizeCssOptions): UsageOptions {
  return {
    exclude: options?.exclude && [...options.exclude],
    assume: options?.assume,
  };
}

/**
 * Throws for `propAware`, removed in 0.14.0: a JavaScript config would
 * otherwise drop it silently.
 */
export function checkRemovedOptions(options?: object): void {
  if (options && "propAware" in options) {
    throw new Error(
      `${LOG_PREFIX} \`propAware\` was removed in 0.14.0: CSS is always pruned by the props the app passes. Remove it, and use \`exclude: ["DataTable"]\` for a component that should keep every variant.`,
    );
  }
}
