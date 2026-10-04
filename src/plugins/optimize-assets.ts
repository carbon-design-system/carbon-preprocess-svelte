import type { CssOptimizer } from "./create-optimized-css";
import type { OptimizeCssOptions } from "./options";
import { logAssetDiff } from "./print-diff";
import { type AssetReport, printReport, toAssetReport } from "./print-report";

export type CssAsset = {
  id: string;
  source: Uint8Array | string;
  /** Replaces the asset's contents; skipped on `dryRun`. */
  write(css: string): void;
};

/**
 * Runs `optimizer` over each asset, writes the result back (unless
 * `dryRun`), and prints the size log and report the options ask for.
 * Shared by the plugins and the CLI.
 */
export function optimizeAssets({
  assets,
  optimizer,
  options,
  moduleTokens,
  contentTokens,
  log,
  reportExtra,
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
}): void {
  const silent = options.silent === true;
  const reports: AssetReport[] = [];

  for (const { id, source, write } of assets) {
    const { css, removed } = optimizer.run(source);

    if (!options.dryRun) write(css);

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
