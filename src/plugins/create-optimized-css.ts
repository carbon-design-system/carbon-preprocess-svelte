import type { UsageResult } from "svelte-prune/internal/analysis";
import { ALWAYS_ON_CLASSES, CONTEXT_ANCESTORS } from "../constants";
import { toCssString } from "../utils";
import {
  type CarbonStylePrunerInput,
  createCarbonStylePruner,
} from "./carbon-style-pruner";
import { hasOptimizableCss } from "./carbon-rules";
import type { OptimizeCssOptions } from "./options";

/** The options that shape what the optimizer prunes. */
export type PruneOptions = Pick<
  OptimizeCssOptions,
  "safelist" | "preserveAllIBMFonts"
>;

/** What the usage analysis found, as the optimizer consumes it. */
export type CssUsage = {
  /** Names of the Carbon components that can render (`Button`, `ButtonSkeleton`). */
  liveComponents: ReadonlySet<string>;
  /** Whether no rendered component can apply `cls` under the app's props. */
  isPruned(cls: string): boolean;
  /** The report's per-component prop lines, given the classes it pruned. */
  report?(prunedClasses: ReadonlySet<string>, root: string): string[];
};

/** A `UsageResult`, as `CssUsage`. */
export function cssUsage(
  result: UsageResult,
  analyzer: typeof import("svelte-prune/internal/analysis"),
): CssUsage {
  return {
    liveComponents: result.liveComponents,
    isPruned: (cls) => result.isPruned(cls),
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
  return {
    analyzer,
    root,
    loadable: (key) => result.analysis.loadable(key),
    files,
  };
}

export type CssOptimizerOptions = PruneOptions & {
  /** Class selectors (`.bx--*`) to keep; pre-scanned so no I/O happens here. */
  contentClasses?: Iterable<string>;
  /** The usage analysis. Without it and `engine`, CSS is left unpruned. */
  analysis?: CssUsage;
  /**
   * svelte-prune's `libraryStylePruner`, from the analysis
   * `optimizeComponents` shares or one CPS collected itself.
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

const NEVER_PRUNED = new Set<string>([
  ...ALWAYS_ON_CLASSES,
  ...CONTEXT_ANCESTORS,
]);

/**
 * `analysis.isPruned`, except for classes the app's own code names
 * (`contentClasses`, exact or as a `bx--x-` prefix). Records every class it
 * prunes in `pruned`.
 */
function createPrunedCheck(
  analysis: CssUsage,
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
      !analysis.isPruned(cls)
    ) {
      return false;
    }
    pruned.add(cls);
    return true;
  };
}

export type CssOptimizer = ReturnType<typeof createCssOptimizer>;

/**
 * Prunes Carbon CSS with svelte-prune's pruner and Carbon's own rules on
 * top (see `createCarbonStylePruner`). Without an analysis, or when
 * svelte-prune can't read Carbon's stylesheets, CSS passes through.
 */
export function createCssOptimizer(options: CssOptimizerOptions) {
  const prunedByProps = new Set<string>();
  const { engine, analysis } = options;
  const carbonPruner =
    engine && analysis
      ? createCarbonStylePruner({
          ...engine,
          isPruned: createPrunedCheck(
            analysis,
            options.contentClasses,
            prunedByProps,
          ),
          liveComponents: analysis.liveComponents,
          safelist: options.safelist ?? [],
          preserveAllIBMFonts: options.preserveAllIBMFonts === true,
        })
      : undefined;

  return {
    usage: {
      components: [...(analysis?.liveComponents ?? [])].sort(),
      prunedByProps,
    },
    /** Whether it prunes at all. */
    prunes: carbonPruner !== undefined,
    run(source: Uint8Array | string): OptimizedCssReport {
      // Bundlers hand over every CSS asset, including chunks with no Carbon
      // styles; skip the parse unless something removable could be present.
      const input = toCssString(source);
      if (!carbonPruner || !hasOptimizableCss(input)) {
        return { css: input, removed: 0 };
      }
      return carbonPruner(input);
    },
  };
}

export function optimizeCssWithReport(
  options: CssOptimizerOptions & { source: Uint8Array | string },
): OptimizedCssReport {
  const { source, ...rest } = options;
  return createCssOptimizer(rest).run(source);
}
