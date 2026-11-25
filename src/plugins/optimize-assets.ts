import type { CssOptimizer } from "./create-optimized-css";
import { setFontDisplay } from "./font-display";
import { byteLength } from "../utils";
import type { OptimizeCssOptions } from "./options";
import { type AssetDiff, logSummary } from "./print-diff";
import { type AssetReport, printReport, toAssetReport } from "./print-report";

export type CssAsset = {
  id: string;
  source: Uint8Array | string;
  /**
   * Replaces the asset's contents; skipped on `dryRun` and when nothing
   * was removed.
   */
  write(css: string): void;
};

/**
 * Runs `optimizer` over each asset, sets `fontDisplay`, writes the
 * results back (unless `dryRun`), and prints one summary of them and the
 * report the options ask for. Shared by the plugins and the CLI. Returns
 * whether it printed a summary.
 */
export function optimizeAssets({
  assets,
  optimizer,
  options,
  moduleTokens,
  contentTokens,
  log,
  reportExtra,
  rewritten,
  onAsset,
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
  /** Hears each asset's sizes in bytes, and the rules removed from it. */
  onAsset?: (asset: {
    id: string;
    before: number;
    after: number;
    removed: number;
  }) => void;
  /**
   * Carbon components `optimizeComponents` rewrote, for the
   * summary's header.
   */
  rewritten?: number;
}): boolean {
  const silent = options.silent === true;
  const reports: AssetReport[] = [];

  const list = [...assets];
  const results = list.map(({ source }) => optimizer.run(source));

  const pruned: AssetDiff[] = [];
  for (const [i, asset] of list.entries()) {
    const { id, source } = asset;
    const { removed } = results[i];
    const css = setFontDisplay(results[i].css, options.fontDisplay);

    if (!options.dryRun && (removed > 0 || css !== results[i].css)) {
      asset.write(css);
    }

    onAsset?.({
      id,
      before: byteLength(source),
      after: byteLength(css),
      removed,
    });

    if (removed > 0)
      pruned.push({ id, originalCss: source, optimizedCss: css });

    if (options.report) reports.push(toAssetReport(id, source, css, removed));
  }

  const logged =
    !silent &&
    logSummary({
      assets: pruned,
      unchanged: list.length - pruned.length,
      rewritten,
      dryRun: options.dryRun,
      log,
    });

  if (options.report) {
    printReport({
      components: optimizer.usage.components,
      moduleTokens,
      contentTokens,
      safelistEntries: options.safelist?.length ?? 0,
      assets: reports,
      dryRun: options.dryRun,
      extra: reportExtra?.(),
    });
  }
  return logged;
}
