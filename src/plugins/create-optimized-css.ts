import type { UsageResult } from "svelte-prune/internal/analysis";
import path from "node:path";
import { ALWAYS_ON_CLASSES, CONTEXT_ANCESTORS } from "../constants";
import type { ComponentIndex } from "../indexer/build-index";
import { toCssString } from "../utils";
import {
  type SpliceOptimizerOptions,
  spliceOptimizeCss,
} from "./css-splice-optimizer";
import {
  type CarbonStylePrunerInput,
  createCarbonStylePruner,
} from "./carbon-style-pruner";
import type { OptimizeCssOptions } from "./options";
import { hasOptimizableCss } from "./strict-css-optimizer";

/** The options that shape what the optimizer prunes. */
export type PruneOptions = Pick<
  OptimizeCssOptions,
  "safelist" | "preserveAllIBMFonts"
>;

/** What `propAware` found, as the optimizer consumes it. */
export type PropAwareUsage = {
  /** Names of the Carbon components that can render (`Button`, `ButtonSkeleton`). */
  liveComponents: ReadonlySet<string>;
  /** Whether no rendered component can apply `cls` under the app's props. */
  isPruned(cls: string): boolean;
  /** The report's prop-aware lines, given the classes it pruned. */
  report?(prunedClasses: ReadonlySet<string>, root: string): string[];
};

/** A `UsageResult`, as `PropAwareUsage`. */
export function propAwareUsage(
  result: UsageResult,
  analyzer: typeof import("svelte-prune/internal/analysis"),
): PropAwareUsage {
  return {
    liveComponents: result.liveComponents,
    isPruned: result.isPruned,
    report: (prunedClasses, root) =>
      analyzer.formatPropAwareReport(result, prunedClasses, root),
  };
}

/**
 * The `engine` for a usage analysis CPS ran itself, from `files`: the app
 * sources it read, whose classes, custom properties and keyframes stay.
 */
export function collectedEngine(
  result: UsageResult,
  analyzer: typeof import("svelte-prune/internal/analysis"),
  root: string,
  files: ReadonlyArray<{ code: string }>,
): NonNullable<CssOptimizerOptions["engine"]> {
  return { analyzer, root, loadable: result.analysis.loadable, files };
}

export type CssOptimizerOptions = PruneOptions & {
  /** Index of the installed Carbon; see `loadComponentIndex`. */
  components: ComponentIndex;
  /** Paths (or bare names) of the Carbon components the app uses. */
  ids: Iterable<string>;
  /** Class selectors (`.bx--*`) to keep; pre-scanned so no I/O happens here. */
  contentClasses?: Iterable<string>;
  propAware?: PropAwareUsage;
  /**
   * With `propAware`: prune with svelte-prune's `libraryStylePruner` instead
   * of the allowlist, from the analysis `optimizeComponents` shares or one
   * CPS collected itself.
   */
  engine?: Pick<
    CarbonStylePrunerInput,
    "analyzer" | "root" | "loadable" | "files"
  >;
};

export type OptimizedCssReport = {
  css: string;
  /** Rules, selectors, `@font-face` blocks and token declarations removed. */
  removed: number;
};

/**
 * The class allowlist: `.bx--body` (apps set it on `<body>`, no component
 * references it), the classes of each used component, and `contentClasses`.
 * Also whether flatpickr CSS stays (any DatePicker import).
 */
function buildUsage(
  componentIndex: ComponentIndex,
  ids: Iterable<string>,
  contentClasses: Iterable<string> = [],
  liveComponents?: ReadonlySet<string>,
) {
  const allowlist = new Set(ALWAYS_ON_CLASSES);
  const usedComponents = new Set<string>();
  let preserveFlatpickr = false;

  for (const id of ids) {
    const { name } = path.parse(id);
    // Bundled, but only rendered from branches the app's props rule out.
    if (liveComponents && !liveComponents.has(name)) continue;

    if (name === "DatePicker") preserveFlatpickr = true;

    if (Object.hasOwn(componentIndex, name)) {
      usedComponents.add(name);
      for (const cls of componentIndex[name].classes) allowlist.add(cls);
    }
  }

  for (const cls of contentClasses) allowlist.add(cls);

  return {
    allowlist,
    preserveFlatpickr,
    components: [...usedComponents].sort(),
  };
}

const NEVER_PRUNED = new Set<string>([
  ...ALWAYS_ON_CLASSES,
  ...CONTEXT_ANCESTORS,
]);

/**
 * `propAware.isPruned`, except for classes the app's own code names
 * (`contentClasses`, exact or as a `bx--x-` prefix). Records every class it
 * prunes in `pruned`.
 */
function createPrunedCheck(
  propAware: PropAwareUsage,
  contentClasses: Iterable<string> | undefined,
  pruned: Set<string>,
): (cls: string) => boolean {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const cls of contentClasses ?? []) {
    if (cls.endsWith("-")) prefixes.push(cls);
    else exact.add(cls);
  }
  return (cls) => {
    if (
      NEVER_PRUNED.has(cls) ||
      exact.has(cls) ||
      prefixes.some((prefix) => cls.startsWith(prefix)) ||
      !propAware.isPruned(cls)
    ) {
      return false;
    }
    pruned.add(cls);
    return true;
  };
}

export type CssOptimizer = ReturnType<typeof createCssOptimizer>;

export function createCssOptimizer(options: CssOptimizerOptions) {
  const { allowlist, preserveFlatpickr, components } = buildUsage(
    options.components,
    options.ids,
    options.contentClasses,
    options.propAware?.liveComponents,
  );
  const prunedByProps = new Set<string>();
  const { engine, propAware } = options;
  const carbonPruner =
    engine && propAware
      ? createCarbonStylePruner({
          ...engine,
          isPruned: createPrunedCheck(
            propAware,
            options.contentClasses,
            prunedByProps,
          ),
          liveComponents: propAware.liveComponents,
          safelist: options.safelist ?? [],
          preserveAllIBMFonts: options.preserveAllIBMFonts === true,
        })
      : undefined;
  const optimizerOptions: SpliceOptimizerOptions = {
    allowlist,
    components: options.components,
    preserveAllIBMFonts: options.preserveAllIBMFonts === true,
    preserveFlatpickr,
    safelist: options.safelist ?? [],
    isPruned:
      options.propAware &&
      createPrunedCheck(
        options.propAware,
        options.contentClasses,
        prunedByProps,
      ),
  };

  return {
    usage: { components, allowlistSize: allowlist.size, prunedByProps },
    /**
     * svelte-prune's pruner already removes the tokens nothing reads; only
     * the allowlist engine needs `pruneUnusedTokens` after it.
     */
    prunesTokens: carbonPruner !== undefined,
    run(source: Uint8Array | string): OptimizedCssReport {
      // Bundlers hand over every CSS asset, including chunks with no Carbon
      // styles; skip the parse unless something removable could be present.
      const input = toCssString(source);
      if (!hasOptimizableCss(input)) return { css: input, removed: 0 };

      return carbonPruner
        ? carbonPruner(input)
        : spliceOptimizeCss(input, optimizerOptions);
    },
  };
}

export function optimizeCssWithReport(
  options: CssOptimizerOptions & { source: Uint8Array | string },
): OptimizedCssReport {
  const { source, ...rest } = options;
  return createCssOptimizer(rest).run(source);
}
