import path from "node:path";
import { ALWAYS_ON_CLASSES } from "../constants";
import type {
  ClassGate,
  ClassVariant,
  ComponentIndex,
  GateCondition,
} from "../indexer/build-index";
import {
  type SpliceOptimizerOptions,
  spliceOptimizeCss,
} from "./css-splice-optimizer";
import type { SafelistEntry } from "./safelist";
import type { PropUsage } from "./scan-props";
import { hasOptimizableCss } from "./strict-css-optimizer";

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
   * Set to `false` to disable verbose logging.
   * @default true
   * @deprecated Use `silent` instead.
   */
  verbose?: boolean;

  /**
   * Run the whole pipeline and print the size log, but leave every CSS
   * asset unchanged. Use it to preview the reduction and check the output
   * before enabling pruning in a production build.
   * @default false
   */
  dryRun?: boolean;

  /**
   * Print a per-build summary of what the plugin detected: imported Carbon
   * components, allowlist size and its sources (module scan, `content`,
   * `safelist`), and per-asset results. Independent of `silent`.
   * @default false
   */
  report?: boolean;

  /**
   * By default, pre-compiled Carbon StyleSheets ship `@font-face` rules
   * for all available IBM Plex fonts, many of which are not actually
   * used in Carbon Svelte components.
   *
   * The default behavior is to preserve the following IBM Plex fonts:
   * - IBM Plex Sans (300/400/600-weight rules; italic only if `<Text italic>` is used)
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
   * virtual modules are skipped. Set to `false` to rely only on imported
   * components, `safelist`, and `content`.
   *
   * The same scan reads the literal values passed to the props that
   * Carbon components derive classes from (Button's `kind`, Tag's `type`,
   * `tooltipPosition`, boolean flags like `filter`) and keeps only the
   * styles those values can produce. With `false`, every variant is kept.
   * @default true
   */
  scanModules?: boolean;
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
  /** Index of the installed Carbon; see `loadComponentIndex`. */
  components: ComponentIndex;
  ids: Iterable<string>;
  /**
   * Class selectors (`.bx--*`) from scanning `content` globs. Pre-scanned by
   * the plugin so the per-asset optimizer does no filesystem I/O. Merged into
   * the allowlist with imported component classes.
   */
  contentClasses?: Iterable<string>;
  /**
   * Literal values the app passes to the props behind the index's class
   * variants, from scanning every bundled module. Without it (the module
   * scan is off, or there is no bundle to scan), every variant is kept.
   */
  propUsage?: PropUsage;
};

/** Classes a component renders only under props no caller passes. */
export type GatedOffUsage = {
  component: string;
  classes: string[];
};

/** Which values of a component's variant prop the allowlist keeps. */
export type VariantUsage = {
  component: string;
  prop: string;
  /** Kept values, default first; `null` when every value is kept. */
  values: string[] | null;
};

/**
 * Build the class allowlist from bundled component paths and whether flatpickr
 * CSS should stay (any DatePicker import).
 *
 * Paths like "Button.svelte" map through the component index to `.bx--*` classes.
 * `.bx--body` is always kept; apps set it on `<body>` but no component file
 * references it.
 *
 * With `propUsage`, a component's variant prefix (`.bx--btn--` for
 * `` `bx--btn--${kind}` ``) expands to the prop's default plus each literal
 * the app passes it, unless something passes it a value the scan can't
 * read. Another bundled component that renders the prefix unconditionally
 * (a parent that renders `<Button kind={…}>`) still keeps it whole.
 */
function buildUsage(
  componentIndex: ComponentIndex,
  ids: Iterable<string>,
  contentClasses?: Iterable<string>,
  propUsage?: PropUsage,
): {
  allowlist: Set<string>;
  preserveFlatpickr: boolean;
  components: string[];
  variants: VariantUsage[];
  denied: Set<string>;
  gatedOff: GatedOffUsage[];
} {
  const allowlist = new Set(ALWAYS_ON_CLASSES);
  const usedComponents = new Set<string>();
  const gatedOffBy = new Map<string, string[]>();
  const usedVariants: Array<[string, ClassVariant]> = [];
  let preserveFlatpickr = false;

  for (const id of ids) {
    const { name } = path.parse(id);

    if (name === "DatePicker") {
      preserveFlatpickr = true;
    }

    if (name in componentIndex && !usedComponents.has(name)) {
      usedComponents.add(name);
      const { classes, variants = [], gates = [] } = componentIndex[name];
      const narrowed = new Map<string, ClassVariant>();
      const gated = new Map<string, ClassGate>(
        propUsage ? gates.map((gate) => [gate.class, gate]) : [],
      );

      for (const variant of variants) {
        usedVariants.push([name, variant]);
        if (propUsage && !propUsage.dynamic.has(variant.prop)) {
          narrowed.set(variant.prefix, variant);
        }
      }

      for (const cls of classes) {
        const gate = gated.get(cls);
        if (gate && propUsage && !canRender(gate, propUsage)) {
          const off = gatedOffBy.get(name) ?? [];
          off.push(cls);
          gatedOffBy.set(name, off);
          continue;
        }

        const variant = narrowed.get(cls);
        if (!variant) {
          allowlist.add(cls);
          continue;
        }

        allowlist.add(`${cls}${variant.default}`);
        for (const value of propUsage?.literals.get(variant.prop) ?? []) {
          allowlist.add(`${cls}${value}`);
        }
      }
    }
  }

  for (const cls of contentClasses ?? []) {
    allowlist.add(cls);
  }

  // A prefix still on the allowlist came in whole from somewhere else.
  const variants = usedVariants.map(([component, variant]) => ({
    component,
    prop: variant.prop,
    values:
      !propUsage ||
      propUsage.dynamic.has(variant.prop) ||
      allowlist.has(variant.prefix)
        ? null
        : [
            ...new Set([
              variant.default,
              ...(propUsage.literals.get(variant.prop) ?? []),
            ]),
          ],
  }));

  // Another bundled component (or the module scan) may still render a
  // gated-off class; only classes nothing else keeps are denied.
  const denied = new Set<string>();
  const gatedOff: GatedOffUsage[] = [];
  for (const [component, classes] of gatedOffBy) {
    const off = classes.filter((cls) => !allowlist.has(cls));
    for (const cls of off) denied.add(cls);
    if (off.length > 0) gatedOff.push({ component, classes: off });
  }

  return {
    allowlist,
    preserveFlatpickr,
    components: [...usedComponents].sort(),
    variants,
    denied,
    gatedOff,
  };
}

/** Whether some place renders the gated class under props callers pass. */
function canRender(gate: ClassGate, usage: PropUsage): boolean {
  return gate.when.some((and) =>
    and.every((condition) => canHold(condition, usage)),
  );
}

/**
 * Whether a condition can hold for some value the prop is given: its
 * default or any literal the scan found, or anything if the prop is
 * dynamic. Literals are strings, so `true` and `"true"` compare equal, and
 * any literal (even `false`) counts as truthy: both only keep extra CSS.
 */
function canHold(condition: GateCondition, usage: PropUsage): boolean {
  if (usage.dynamic.has(condition.prop)) return true;
  const literals = usage.literals.get(condition.prop) ?? new Set<string>();

  if (condition.equals === undefined) {
    return Boolean(condition.default) || literals.size > 0;
  }

  const expected = String(condition.equals);
  return (
    (condition.default !== null && String(condition.default) === expected) ||
    literals.has(expected)
  );
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

export function toCssString(
  source: CreateOptimizedCssOptions["source"],
): string {
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
  const {
    allowlist,
    preserveFlatpickr,
    components,
    variants,
    denied,
    gatedOff,
  } = buildUsage(
    options.components,
    options.ids,
    options.contentClasses,
    options.propUsage,
  );
  const optimizerOptions: SpliceOptimizerOptions = {
    allowlist,
    components: options.components,
    preserveAllIBMFonts: options.preserveAllIBMFonts === true,
    preserveFlatpickr,
    safelist: options.safelist ?? [],
    denied,
  };

  return {
    usage: { components, allowlistSize: allowlist.size, variants, gatedOff },
    run(source: CreateOptimizedCssOptions["source"]): OptimizedCssReport {
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
