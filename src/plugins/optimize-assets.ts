import type { CssOptimizer } from "./create-optimized-css";
import type { OptimizeCssOptions } from "./options";
import { logAssetDiff } from "./print-diff";
import { type AssetReport, printReport, toAssetReport } from "./print-report";
import { pruneUnusedTokens } from "./prune-tokens";

export type CssAsset = {
  id: string;
  source: Uint8Array | string;
  /** Replaces the asset's contents; skipped on `dryRun` and when nothing was removed. */
  write(css: string): void;
};

/**
 * Runs `optimizer` over each asset, then (given `tokenNames`) drops the
 * Carbon tokens no asset reads, writes the results back (unless `dryRun`),
 * and prints the size log and report the options ask for. Shared by the
 * plugins and the CLI.
 */
export function optimizeAssets({
  assets,
  optimizer,
  options,
  moduleTokens,
  contentTokens,
  log,
  reportExtra,
  tokenNames,
}: {
  assets: Iterable<CssAsset>;
  optimizer: CssOptimizer;
  options: OptimizeCssOptions;
  /** Omit when there is no module scan (the CLI). */
  moduleTokens?: number;
  contentTokens: number;
  /** Where size logs go; `console.log` when unset. */
  log?: (message: string) => void;
  /** Lines appended to the report, read after every asset has run. */
  reportExtra?: () => string[];
  /**
   * `--cds-` names found in the build's scripts and markup. Only a caller
   * that sees everything the build ships can pass them; without them every
   * token stays.
   */
  tokenNames?: Iterable<string>;
}): void {
  const silent = options.silent === true;
  const reports: AssetReport[] = [];

  const list = [...assets];
  const results = list.map(({ source }) => optimizer.run(source));
  if (tokenNames) {
    const tokens = pruneUnusedTokens(
      results.map((result) => result.css),
      tokenNames,
    );
    for (const [i, result] of results.entries()) {
      results[i] = {
        css: tokens.css[i],
        removed: result.removed + tokens.removed[i],
      };
    }
  }

  for (const [i, { id, source, write }] of list.entries()) {
    const { css, removed } = results[i];

    if (!options.dryRun && removed > 0) write(css);

    if (!silent && removed > 0) {
      logAssetDiff({
        id,
        originalCss: source,
        optimizedCss: css,
        dryRun: options.dryRun,
        log,
      });
    }

    if (options.report) reports.push(toAssetReport(id, source, css, removed));
  }

  if (options.report) {
    printReport({
      components: optimizer.usage.components,
      allowlistSize: optimizer.usage.allowlistSize,
      moduleTokens,
      contentTokens,
      safelistEntries: options.safelist?.length ?? 0,
      assets: reports,
      dryRun: options.dryRun,
      extra: reportExtra?.(),
    });
  }
}
