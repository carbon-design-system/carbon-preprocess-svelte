import path from "node:path";
import { ALWAYS_ON_CLASSES } from "../constants";
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

export type CssOptimizerOptions = PruneOptions & {
  /** Index of the installed Carbon; see `loadComponentIndex`. */
  components: ComponentIndex;
  /** Paths (or bare names) of the Carbon components the app uses. */
  ids: Iterable<string>;
  /** Class selectors (`.bx--*`) to keep; pre-scanned so no I/O happens here. */
  contentClasses?: Iterable<string>;
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
) {
  const allowlist = new Set(ALWAYS_ON_CLASSES);
  const usedComponents = new Set<string>();
  let preserveFlatpickr = false;

  for (const id of ids) {
    const { name } = path.parse(id);

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

export type CssOptimizer = ReturnType<typeof createCssOptimizer>;

export function createCssOptimizer(options: CssOptimizerOptions) {
  const { allowlist, preserveFlatpickr, components } = buildUsage(
    options.components,
    options.ids,
    options.contentClasses,
  );
  const optimizerOptions: SpliceOptimizerOptions = {
    allowlist,
    components: options.components,
    preserveAllIBMFonts: options.preserveAllIBMFonts === true,
    preserveFlatpickr,
    safelist: options.safelist ?? [],
  };

  return {
    usage: { components, allowlistSize: allowlist.size },
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
