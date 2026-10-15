import { BYTES_PER_KB } from "../constants";
import { byteLength } from "../utils";

// Made on first use, like `print-diff.ts`'s: an `Intl.NumberFormat` costs
// milliseconds at import.
let countFormatter: Intl.NumberFormat | undefined;
let sizeFormatter: Intl.NumberFormat | undefined;

const COLUMN_GAP = "   ";

export type AssetReport = {
  id: string;
  removed: number;
  beforeBytes: number;
  afterBytes: number;
};

export type OptimizeCssReportInput = {
  components: string[];
  allowlistSize: number;
  /** Tokens from the bundler module scan; omitted by the CLI, which has none. */
  moduleTokens?: number;
  contentTokens: number;
  safelistEntries: number;
  assets: AssetReport[];
  dryRun?: boolean;
  /** Lines printed after the asset table (`propAware`). */
  extra?: string[];
};

export function toAssetReport(
  id: string,
  originalCss: Uint8Array | string,
  optimizedCss: string,
  removed: number,
): AssetReport {
  return {
    id,
    removed,
    beforeBytes: byteLength(originalCss),
    afterBytes: byteLength(optimizedCss),
  };
}

function toKB(bytes: number): string {
  sizeFormatter ??= new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sizeFormatter.format(bytes / BYTES_PER_KB)} kB`;
}

/** Right-pads every value to the width of the longest one in the column. */
function padColumn(values: string[]): string[] {
  const width = Math.max(0, ...values.map((value) => value.length));
  return values.map((value) => value.padEnd(width));
}

export function printReport(input: OptimizeCssReportInput): void {
  const { components, allowlistSize, moduleTokens, assets, dryRun } = input;
  countFormatter ??= new Intl.NumberFormat("en-US");
  const counts = countFormatter;
  const count = (n: number) => counts.format(n);

  const sources = [
    ...(moduleTokens === undefined
      ? []
      : [`module scan ${count(moduleTokens)} tokens`]),
    `content ${count(input.contentTokens)} tokens`,
    `safelist ${count(input.safelistEntries)} entries`,
  ];

  console.log("");
  console.log("carbon-preprocess-svelte report");
  console.log(
    `  Detected components (${components.length}): ${components.join(", ") || "none"}`,
  );
  console.log(
    `  Allowlist: ${count(allowlistSize)} classes (${sources.join(", ")})`,
  );
  console.log(`  Assets:${dryRun ? " (dry run, assets unchanged)" : ""}`);

  const ids = padColumn(assets.map((asset) => asset.id));
  const statuses = padColumn(
    assets.map((asset) =>
      asset.removed > 0
        ? `${count(asset.removed)} rules removed`
        : "nothing to prune",
    ),
  );
  const sizes = assets.map((asset) =>
    asset.removed > 0
      ? `${toKB(asset.beforeBytes)} -> ${toKB(asset.afterBytes)}`
      : toKB(asset.beforeBytes),
  );

  for (const [index, id] of ids.entries()) {
    console.log(
      `    ${id}${COLUMN_GAP}${statuses[index]}${COLUMN_GAP}${sizes[index]}`,
    );
  }

  for (const line of input.extra ?? []) console.log(line);
}
