import type {
  SharedAnalysis,
  UsageResult,
} from "svelte-prune/internal/analysis";
import {
  type CssOptimizer,
  type CssOptimizerOptions,
  collectedEngine,
  createCssOptimizer,
  type CssUsage,
  cssUsage,
} from "./create-optimized-css";
import { SHARED_ANALYSIS_FAILED } from "./messages";
import type { OptimizeCssOptions } from "./options";
import { tokenNamesFile } from "./token-names";

type Analyzer = typeof import("svelte-prune/internal/analysis");

/** Call sites CPS read itself, without `optimizeComponents` in the build. */
type Collected = {
  result: UsageResult | { warning: string };
  /** The app sources it read, whose classes, tokens and keyframes stay. */
  files: ReadonlyArray<{ code: string }>;
};

export type CssPruning = {
  optimizer: CssOptimizer;
  /** The usage analysis; without it, CSS is left unpruned. */
  usage: CssUsage | undefined;
  /** What svelte-prune's pruner reads custom properties in. */
  files: ReadonlyArray<{ code: string }> | undefined;
};

/**
 * The optimizer a build prunes its CSS with, shared by the plugins and
 * `createCarbonOptimizer`: they differ only in how they collect its
 * inputs. It prunes from `optimizeComponents`' analysis (`shared`) when
 * that's in the build, else from the call sites `collect` reads, and
 * leaves the CSS unpruned with a warning when neither can be read.
 */
export async function prepareCssPruning(input: {
  options: OptimizeCssOptions | undefined;
  root: string;
  /** `bx--` classes from `content` and the scanned modules. */
  classes: Iterable<string>;
  /**
   * `--cds-` names the app's code, markup and `content` name, and its own
   * stylesheets read: svelte-prune's pruner keeps the tokens they need.
   */
  namedTokens: Iterable<string>;
  analyzer: Analyzer | undefined;
  /** The Carbon stylesheets the build bundles; see `bundledStylesheets`. */
  stylesheets?: readonly string[];
  shared: (() => SharedAnalysis | undefined) | undefined;
  collect: (() => Promise<Collected | undefined>) | undefined;
  /** Already silenced by `silent`. */
  warn(message: string): void;
}): Promise<CssPruning> {
  const { analyzer, root } = input;
  const namedTokens = tokenNamesFile(input.namedTokens);
  let usage: CssUsage | undefined;
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
        loadable: (key) => analysis.usage.loadable(key),
        files: [...analysis.files, namedTokens],
        stylesheets: input.stylesheets,
      };
    } else input.warn(SHARED_ANALYSIS_FAILED);
  } else if (input.collect && analyzer) {
    const collected = await input.collect();
    const result = collected?.result;
    if (result && "warning" in result) {
      input.warn(result.warning);
    } else if (collected && result) {
      usage = cssUsage(result, analyzer);
      engine = {
        ...collectedEngine(result, analyzer, root, [
          ...collected.files,
          namedTokens,
        ]),
        stylesheets: input.stylesheets,
      };
    }
  }
  const classes = [...input.classes];
  return {
    optimizer: createCssOptimizer({
      ...input.options,
      contentClasses: classes,
      analysis: usage,
      engine,
    }),
    usage,
    files: engine?.files,
  };
}
