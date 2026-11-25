import { globSync } from "node:fs";
import path from "node:path";
import { CARBON, CSS_FAILURE } from "../carbon-library";
import { toCssString } from "../utils";
import {
  collectedEngine,
  type CssOptimizerOptions,
  optimizeCssWithReport,
  type OptimizedCssReport,
  cssUsage,
  type CssUsage,
  type PruneOptions,
} from "./create-optimized-css";
import { setFontDisplay } from "./font-display";
import { undeclaredTokens } from "./messages";
import {
  checkRemovedOptions,
  type OptimizeCssOptions,
  usageOptions,
} from "./options";
import { collectTokenNames, tokenNamesFile } from "./token-names";
import { collectCarbonTokens, readFiles, scanContent } from "./scan-content";
import { findUndeclaredTokens } from "./undeclared-tokens";

type OptimizeCarbonCssOptions = PruneOptions &
  Pick<OptimizeCssOptions, "content" | "exclude" | "assume" | "fontDisplay"> & {
    /**
     * Carbon components used by the app, as names (`"Button"`) or paths to
     * their `.svelte` source. Their styles are pruned by the props the
     * `content` files pass, so `content` must cover every file that renders
     * them; one no file renders, or every one without `content`, renders
     * with any props. An empty list returns the CSS unchanged.
     */
    components: Iterable<string>;

    /**
     * Source code to scan for literal `bx--` tokens, for example the JS output
     * of your bundler. Same detection as the plugins' `scanModules`. When
     * given, it should be everything the app ships besides this CSS: Carbon
     * tokens (`--cds-*`) that neither it nor the CSS reads are removed too.
     * Without it, every token stays.
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
 * It reads the app's call sites from `content` itself, without what
 * `optimizeComponents` rewrote; `createCarbonOptimizer` prunes from that
 * analysis, as a Vite build with both plugins does.
 */
export async function optimizeCarbonCss(
  css: string | Uint8Array,
  options: OptimizeCarbonCssOptions,
): Promise<OptimizedCssReport> {
  checkRemovedOptions(options);
  const ids = [...options.components];
  if (ids.length === 0) {
    return {
      css: setFontDisplay(toCssString(css), options.fontDisplay),
      removed: 0,
    };
  }
  const cwd = path.resolve(options.cwd ?? process.cwd());

  const scan = scanContent(options.content, cwd);
  const contentClasses = new Set(scan.classes);
  const tokenNames = options.sources ? new Set(scan.tokens) : undefined;
  for (const source of options.sources ?? []) {
    collectCarbonTokens(source, contentClasses);
    if (tokenNames) collectTokenNames(source, tokenNames);
  }

  // Without `sources`, nothing says which tokens the build reads: every one
  // stays. A bare `--cds-` keeps them all.
  const analyzed = await analyze(
    options,
    ids,
    cwd,
    tokenNamesFile(tokenNames ?? ["--cds-"]),
  );
  const report = optimizeCssWithReport({
    source: css,
    contentClasses,
    safelist: options.safelist,
    preserveAllIBMFonts: options.preserveAllIBMFonts,
    analysis: analyzed?.usage,
    engine: analyzed?.engine,
  });
  // Only `sources` says what else the build ships, so only with it can a
  // read be known to resolve to nothing.
  if (tokenNames) {
    const undeclared = findUndeclaredTokens([report.css], tokenNames);
    if (undeclared.length > 0) console.warn(undeclaredTokens(undeclared));
  }
  return { ...report, css: setFontDisplay(report.css, options.fontDisplay) };
}

/**
 * The usage analysis, from the `content` files. Without them, each of
 * `components` renders with any props: every variant stays, and only what
 * they never render goes. `undefined` (CSS unpruned, warned) if it fails.
 */
async function analyze(
  options: OptimizeCarbonCssOptions,
  ids: string[],
  cwd: string,
  namedTokens: { code: string },
): Promise<
  { usage: CssUsage; engine: CssOptimizerOptions["engine"] } | undefined
> {
  const content = options.content ?? [];
  const analyzer = await import("svelte-prune/internal/analysis");
  const files =
    content.length > 0 ? [...readFiles(globSync(content, { cwd }), cwd)] : [];
  const result = await analyzer.analyzeFiles({
    library: CARBON,
    failure: CSS_FAILURE,
    projectRoot: cwd,
    files,
    components: ids,
    options: usageOptions(options),
  });
  if ("warning" in result) {
    console.warn(result.warning);
    return undefined;
  }
  return {
    usage: cssUsage(result, analyzer),
    engine: collectedEngine(result, analyzer, cwd, [...files, namedTokens]),
  };
}
