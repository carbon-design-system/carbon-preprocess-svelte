import { globSync } from "node:fs";
import path from "node:path";
import { CARBON, PROP_AWARE_FAILURE } from "../carbon-library";
import { LOG_PREFIX } from "../constants";
import { loadComponentIndex } from "../indexer/load-index";
import { toCssString } from "../utils";
import {
  collectedEngine,
  type CssOptimizerOptions,
  optimizeCssWithReport,
  type OptimizedCssReport,
  propAwareUsage,
  type PropAwareUsage,
  type PruneOptions,
} from "./create-optimized-css";
import { type OptimizeCssOptions, propAwareOptions } from "./options";
import {
  collectTokenNames,
  pruneUnusedTokens,
  tokenNamesFile,
} from "./prune-tokens";
import { collectCarbonTokens, readFiles, scanContent } from "./scan-content";

type OptimizeCarbonCssOptions = PruneOptions &
  Pick<OptimizeCssOptions, "content" | "propAware"> & {
    /**
     * Carbon components used by the app, as names (`"Button"`) or paths to
     * their `.svelte` source. Classes referenced by these components are kept.
     * An empty list returns the CSS unchanged.
     */
    components: Iterable<string>;

    /**
     * Source code to scan for literal `bx--` tokens, for example the JS output
     * of your bundler. Same detection as the plugins' `scanModules`. When
     * given, it should be everything the app ships besides this CSS: Carbon
     * tokens (`--cds-*`) that neither it nor the CSS reads are removed too.
     */
    sources?: Iterable<string>;

    /**
     * Project directory: `content` globs resolve from it, and the installed
     * `carbon-components-svelte` is resolved from it.
     * @default process.cwd()
     */
    cwd?: string;
  };

/**
 * Bundler-agnostic entry point for the CSS optimizer, for build tools
 * without a plugin here: the caller supplies the used components directly.
 */
export async function optimizeCarbonCss(
  css: string | Uint8Array,
  options: OptimizeCarbonCssOptions,
): Promise<OptimizedCssReport> {
  const ids = [...options.components];
  const components =
    ids.length > 0 ? await loadComponentIndex(options.cwd) : undefined;
  // Without components, or if the index failed (already warned): unpruned.
  if (!components) return { css: toCssString(css), removed: 0 };

  const scan = scanContent(options.content, options.cwd);
  const contentClasses = new Set(scan.classes);
  const tokenNames = options.sources ? new Set(scan.tokens) : undefined;
  for (const source of options.sources ?? []) {
    collectCarbonTokens(source, contentClasses);
    if (tokenNames) collectTokenNames(source, tokenNames);
  }

  // Without `sources`, nothing says which tokens the build reads: every one
  // stays, as without propAware. A bare `--cds-` keeps them all.
  const analyzed = await analyzePropAware(
    options,
    ids,
    tokenNamesFile(tokenNames ?? ["--cds-"]),
  );
  const report = optimizeCssWithReport({
    source: css,
    components,
    ids,
    contentClasses,
    safelist: options.safelist,
    preserveAllIBMFonts: options.preserveAllIBMFonts,
    propAware: analyzed?.usage,
    engine: analyzed?.engine,
  });
  if (!tokenNames) return report;
  const tokens = pruneUnusedTokens([report.css], tokenNames);
  return { css: tokens.css[0], removed: report.removed + tokens.removed[0] };
}

/**
 * `propAware` reads call sites from the `content` files, so it needs
 * them: without `content` it's skipped, with a warning if it was asked for.
 */
async function analyzePropAware(
  options: OptimizeCarbonCssOptions,
  ids: string[],
  namedTokens: { code: string },
): Promise<
  { usage: PropAwareUsage; engine: CssOptimizerOptions["engine"] } | undefined
> {
  const propAware = propAwareOptions(options);
  if (!propAware) return undefined;
  const cwd = path.resolve(options.cwd ?? process.cwd());
  if (!options.content || options.content.length === 0) {
    // On by default, it needs `content` to run: only asking for it warns.
    if (options.propAware === undefined) return undefined;
    console.warn(
      `${LOG_PREFIX} propAware needs \`content\` globs covering every file that renders Carbon components; CSS was pruned without it.`,
    );
    return undefined;
  }
  const analyzer = await import("svelte-prune/internal/analysis");
  const files = [...readFiles(globSync(options.content, { cwd }), cwd)];
  const result = await analyzer.analyzeFiles({
    library: CARBON,
    failure: PROP_AWARE_FAILURE,
    projectRoot: cwd,
    files,
    components: ids,
    options: propAware,
  });
  if (!("warning" in result)) {
    return {
      usage: propAwareUsage(result, analyzer),
      engine: collectedEngine(result, analyzer, cwd, [...files, namedTokens]),
    };
  }
  console.warn(result.warning);
  return undefined;
}
