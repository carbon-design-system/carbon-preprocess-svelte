import { BITS_DENOM } from "../constants";

const countFormatter = new Intl.NumberFormat("en-US");
const sizeFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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
  moduleTokens: number;
  contentTokens: number;
  safelistEntries: number;
  assets: AssetReport[];
  dryRun?: boolean;
};

/** Byte counts for one asset, from a string or Uint8Array source. */
export function toAssetReport(
  id: string,
  original_css: Uint8Array | string,
  optimized_css: string,
  removed: number,
): AssetReport {
  return {
    id,
    removed,
    beforeBytes:
      typeof original_css === "string"
        ? Buffer.byteLength(original_css)
        : original_css.byteLength,
    afterBytes: Buffer.byteLength(optimized_css),
  };
}

function toKB(bytes: number): string {
  return `${sizeFormatter.format(bytes / BITS_DENOM)} kB`;
}

/** Right-pads every value to the width of the longest one in the column. */
function padColumn(values: string[]): string[] {
  if (values.length === 0) return [];
  const width = Math.max(...values.map((value) => value.length));
  return values.map((value) => value.padEnd(width));
}

export function printReport(input: OptimizeCssReportInput): void {
  const {
    components,
    allowlistSize,
    moduleTokens,
    contentTokens,
    safelistEntries,
    assets,
    dryRun,
  } = input;

  console.log("");
  console.log("carbon-preprocess-svelte report");
  console.log(
    `  Detected components (${components.length}): ${
      components.length === 0 ? "none" : components.join(", ")
    }`,
  );
  console.log(
    `  Allowlist: ${countFormatter.format(allowlistSize)} classes (module scan ${countFormatter.format(
      moduleTokens,
    )} tokens, content ${countFormatter.format(
      contentTokens,
    )} tokens, safelist ${countFormatter.format(safelistEntries)} entries)`,
  );
  console.log(`  Assets:${dryRun ? " (dry run, assets unchanged)" : ""}`);

  const ids = padColumn(assets.map((asset) => asset.id));
  const statuses = padColumn(
    assets.map((asset) =>
      asset.removed > 0
        ? `${countFormatter.format(asset.removed)} rules removed`
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
}
