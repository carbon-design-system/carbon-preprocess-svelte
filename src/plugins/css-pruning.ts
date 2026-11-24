import type {
  SharedAnalysis,
  UsageResult,
} from "svelte-prune/internal/analysis";
import type { ComponentIndex } from "../indexer/build-index";
import {
  type CssOptimizer,
  type CssOptimizerOptions,
  collectedEngine,
  createCssOptimizer,
  type PropAwareUsage,
  propAwareUsage,
} from "./create-optimized-css";
import { SHARED_ANALYSIS_FAILED } from "./messages";
import type { OptimizeCssOptions } from "./options";
import { tokenNamesFile } from "./prune-tokens";

type Analyzer = typeof import("svelte-prune/internal/analysis");

/** Call sites CPS read itself, without `optimizeComponents` in the build. */
type Collected = {
  result: UsageResult | { warning: string };
  /** The app sources it read, whose classes, tokens and keyframes stay. */
  files: ReadonlyArray<{ code: string }>;
};

export type CssPruning = {
  optimizer: CssOptimizer;
  usage: PropAwareUsage | undefined;
  /** What svelte-prune's pruner reads custom properties in, with `propAware`. */
  files: ReadonlyArray<{ code: string }> | undefined;
};

/**
 * The optimizer a build prunes its CSS with, shared by the plugins and
 * `createCarbonOptimizer`: they differ only in how they collect its
 * inputs. With `propAware`, it prunes from `optimizeComponents`' analysis
 * (`shared`) when that's in the build, else from the call sites `collect`
 * reads, and falls back to the imported components alone with a warning.
 */
export async function prepareCssPruning(input: {
  options: OptimizeCssOptions | undefined;
  root: string;
  components: ComponentIndex;
  /** The Carbon components the build bundles. */
  ids: Iterable<string>;
  /** `bx--` classes from `content` and the scanned modules. */
  classes: Iterable<string>;
  /**
   * `--cds-` names the app's code, markup and `content` name, and its own
   * stylesheets read: svelte-prune's pruner keeps the tokens they need.
   */
  namedTokens: Iterable<string>;
  analyzer: Analyzer | undefined;
  shared: (() => SharedAnalysis | undefined) | undefined;
  collect: (() => Promise<Collected | undefined>) | undefined;
  /** Already silenced by `silent`. */
  warn(message: string): void;
}): Promise<CssPruning> {
  const { analyzer, root } = input;
  const namedTokens = tokenNamesFile(input.namedTokens);
  let usage: PropAwareUsage | undefined;
  let engine: CssOptimizerOptions["engine"];
  if (input.shared) {
    // The same reading of the call sites `optimizeComponents` rewrote for, so
    // the CSS keeps exactly what the components render.
    const analysis = input.shared();
    if (analysis && !("warning" in analysis) && analyzer) {
      usage = analysis.usage;
      engine = {
        analyzer,
        root,
        loadable: analysis.usage.loadable,
        files: [...analysis.files, namedTokens],
      };
    } else input.warn(SHARED_ANALYSIS_FAILED);
  } else if (input.collect && analyzer) {
    const collected = await input.collect();
    if (collected && "warning" in collected.result) {
      input.warn(collected.result.warning);
    } else if (collected) {
      const { result } = collected as { result: UsageResult };
      usage = propAwareUsage(result, analyzer);
      engine = collectedEngine(result, analyzer, root, [
        ...collected.files,
        namedTokens,
      ]);
    }
  }
  const classes = [...input.classes];
  return {
    optimizer: createCssOptimizer({
      ...input.options,
      components: input.components,
      ids: input.ids,
      contentClasses: classes,
      propAware: usage,
      engine,
    }),
    usage,
    files: engine?.files,
  };
}
