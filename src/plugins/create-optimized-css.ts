import path from "node:path";
import { ALWAYS_ON_CLASSES, CONTEXT_ANCESTORS } from "../constants";
import type { ComponentIndex } from "../indexer/build-index";
import { toCssString } from "../utils";
import {
  type SpliceOptimizerOptions,
  spliceOptimizeCss,
} from "./css-splice-optimizer";
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
  liveComponents: Set<string>;
  /** Whether no rendered component can apply `cls` under the app's props. */
  isPruned(cls: string): boolean;
};

export type CssOptimizerOptions = PruneOptions & {
  /** Index of the installed Carbon; see `loadComponentIndex`. */
  components: ComponentIndex;
  /** Paths (or bare names) of the Carbon components the app uses. */
  ids: Iterable<string>;
  /** Class selectors (`.bx--*`) to keep; pre-scanned so no I/O happens here. */
  contentClasses?: Iterable<string>;
  /** Set by `propAware`. */
  propAware?: PropAwareUsage;
};

export type OptimizedCssReport = {
  css: string;
  /** Rules, selectors, and `@font-face` blocks removed. */
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
  liveComponents?: Set<string>,
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
    run(source: Uint8Array | string): OptimizedCssReport {
      // Bundlers hand over every CSS asset, including chunks with no Carbon
      // styles; skip the parse unless something removable could be present.
      const input = toCssString(source);
      if (!hasOptimizableCss(input)) return { css: input, removed: 0 };

      return spliceOptimizeCss(input, optimizerOptions);
    },
  };
}

export function optimizeCssWithReport(
  options: CssOptimizerOptions & { source: Uint8Array | string },
): OptimizedCssReport {
  const { source, ...rest } = options;
  return createCssOptimizer(rest).run(source);
}
