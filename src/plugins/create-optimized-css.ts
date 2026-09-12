import path from "node:path";
import { getComponents } from "../component-index-registry";
import { ALWAYS_ON_CLASSES } from "../constants";
import {
  type SpliceOptimizerOptions,
  spliceOptimizeCss,
} from "./css-splice-optimizer";
import type { SafelistEntry } from "./safelist";
import { hasOptimizableCss } from "./strict-css-optimizer";

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

  /**
   * Class selectors to always keep, regardless of which components are
   * imported. For Carbon classes the allowlist misses:
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
   * Glob patterns (relative to the current working directory) of source files
   * to scan for literal `bx--`-prefixed tokens. Every token found is kept.
   * For ``class={`bx--btn--${kind}`}``, the prefix `bx--btn--` in source
   * keeps runtime variants like `.bx--btn--primary`.
   *
   * @example
   * content: ["src/**\/*.{svelte,js,ts}"]
   */
  content?: string[];

  experimental?: {
    /**
     * Build the component index from *this project's* installed
     * `carbon-components-svelte` instead of using the version bundled with
     * `carbon-preprocess-svelte`. Resolved once per build (cached on disk,
     * keyed by the Carbon and preprocessor versions) and falls back to the bundled
     * index if anything about the live build fails.
     * @default false
     */
    liveIndex?: boolean;
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

type CreateOptimizedCssOptions = OptimizeCssOptions & {
  source: Uint8Array | string;
  ids: Iterable<string>;
  /**
   * Class selectors (`.bx--*`) from scanning `content` globs. Pre-scanned by
   * the plugin so the per-asset optimizer does no filesystem I/O. Merged into
   * the allowlist with imported component classes.
   */
  contentClasses?: Iterable<string>;
};

/**
 * Build the class allowlist from bundled component paths and whether flatpickr
 * CSS should stay (any DatePicker import).
 *
 * Paths like "Button.svelte" map through component-index to `.bx--*` classes.
 * `.bx--body` is always kept; apps set it on `<body>` but no component file
 * references it.
 */
function buildUsage(
  ids: Iterable<string>,
  contentClasses?: Iterable<string>,
): {
  allowlist: Set<string>;
  preserveFlatpickr: boolean;
} {
  const allowlist = new Set(ALWAYS_ON_CLASSES);
  const components = getComponents();
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

  for (const cls of contentClasses ?? []) {
    allowlist.add(cls);
  }

  return { allowlist, preserveFlatpickr };
}

/**
 * The optimized CSS plus a count of how many Carbon rules/selectors/font-faces
 * were removed. Callers use `removed` to suppress the size diff log when nothing
 * was actually pruned.
 */
export type OptimizedCssReport = {
  css: string;
  removed: number;
};

function toCssString(source: CreateOptimizedCssOptions["source"]): string {
  if (typeof source === "string") return source;
  // Same decoding PostCSS applies to a Buffer, without copying the bytes.
  return Buffer.from(
    source.buffer,
    source.byteOffset,
    source.byteLength,
  ).toString();
}

export function createCssOptimizer(
  options: Omit<CreateOptimizedCssOptions, "source">,
) {
  const { allowlist, preserveFlatpickr } = buildUsage(
    options.ids,
    options.contentClasses,
  );
  const optimizerOptions: SpliceOptimizerOptions = {
    allowlist,
    preserveAllIBMFonts: options.preserveAllIBMFonts === true,
    preserveFlatpickr,
    safelist: options.safelist ?? [],
  };

  return {
    // Second argument is unused now that the scanner never falls back to
    // PostCSS (it only ever needed `from` for PostCSS's own `Input`
    // bookkeeping); kept in the signature since the Vite/webpack plugins
    // still pass the asset id.
    run(
      source: CreateOptimizedCssOptions["source"],
      _from?: string,
    ): OptimizedCssReport {
      // Bundlers hand every CSS asset to the plugin, including per-route
      // chunks with no Carbon styles at all. Parsing and re-serializing
      // those is pure overhead, so skip the scanner unless something
      // removable could be present.
      const input = toCssString(source);
      if (!hasOptimizableCss(input)) {
        return { css: input, removed: 0 };
      }

      return spliceOptimizeCss(input, optimizerOptions);
    },
  };
}

export function optimizeCssWithReport(
  options: CreateOptimizedCssOptions,
): OptimizedCssReport {
  const { source, ...rest } = options;
  return createCssOptimizer(rest).run(source);
}

export function createOptimizedCss(options: CreateOptimizedCssOptions): string {
  return optimizeCssWithReport(options).css;
}
