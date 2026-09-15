import { BITS_DENOM } from "../constants";
import { toCssString } from "./create-optimized-css";

export type AssetDiff = {
  original_css: Uint8Array | string;
  optimized_css: string;
  id: string;
};

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/**
 * Converts kilobyte values to human-readable format with appropriate units.
 * Uses decimal system (1 MB = 1000 kB) to match Vite's output conventions.
 */
function toHumanReadableSize(size_in_kb: number) {
  if (size_in_kb >= BITS_DENOM) {
    return `${formatter.format(size_in_kb / BITS_DENOM)} MB`;
  }

  return `${formatter.format(size_in_kb)} kB`;
}

function percentageDiff(a: number, b: number) {
  return `${formatter.format(((a - b) / a) * 100)}%`;
}

/**
 * Calculates the size of a string in kilobytes.
 *
 * Uses Blob to get accurate byte size regardless of character encoding,
 * which handles multi-byte UTF-8 characters correctly (unlike str.length).
 */
function stringSizeInKB(str: string) {
  const blob = new Blob([str], { type: "text/plain" });
  return blob.size / BITS_DENOM;
}

function padIfNeeded(a: string, b: string) {
  return a.padStart(b.length, " ");
}

/**
 * Computes the display strings shared by `printDiff` and `formatDiff`.
 * Returns `null` when sizes are equal. That means no Carbon CSS was
 * present, or every detected component's styles were kept.
 */
function measure(props: Omit<AssetDiff, "id">) {
  const { original_css, optimized_css } = props;

  const original_size = stringSizeInKB(toCssString(original_css));
  const optimized_size = stringSizeInKB(optimized_css);

  if (original_size === optimized_size) {
    return null;
  }

  const original = toHumanReadableSize(original_size);
  const optimized = toHumanReadableSize(optimized_size);
  const original_display = padIfNeeded(original, optimized);
  const optimized_display = padIfNeeded(optimized, original);
  const diff = percentageDiff(original_size, optimized_size);

  return { original_display, optimized_display, diff };
}

/**
 * Prints a formatted summary of CSS optimization results to the console.
 *
 * Shows the original and optimized file sizes with percentage reduction.
 * Silently returns if no size change occurred (e.g., when the CSS contains
 * no Carbon styles or all Carbon components are in use).
 */
export function printDiff(props: AssetDiff) {
  const { id } = props;
  const result = measure(props);

  if (result === null) {
    return;
  }

  const { original_display, optimized_display, diff } = result;

  console.log("\n");
  console.log("Optimized", id);
  console.log("Before:", original_display);
  console.log("After: ", optimized_display, `(-${diff})\n`);
}

/**
 * The size block as one string, identical to what `printDiff` writes with
 * four `console.log` calls. Returns `null` when nothing changed. One string
 * lets a host logger (Vite's `config.logger`) emit it as a single message,
 * which keeps the block intact for anything parsing the output.
 */
export function formatDiff(props: AssetDiff): string | null {
  const { id } = props;
  const result = measure(props);

  if (result === null) {
    return null;
  }

  const { original_display, optimized_display, diff } = result;

  return `\n\nOptimized ${id}\nBefore: ${original_display}\nAfter:  ${optimized_display} (-${diff})\n`;
}

/**
 * Logs the dry-run notice and size block for one asset. Plugins and the CLI
 * share this. When `log` is set, both go through that function, which Vite
 * sets to `config.logger.info`. Otherwise `printDiff` writes to the console
 * so the block's bytes match on every bundler.
 */
export function logAssetDiff(
  props: AssetDiff & { dryRun?: boolean; log?: (message: string) => void },
): void {
  const { dryRun, log, ...diff } = props;

  if (dryRun) {
    (log ?? console.log)(`Dry run: ${diff.id} left unchanged`);
  }

  if (log) {
    const block = formatDiff(diff);
    if (block !== null) log(block);
  } else {
    printDiff(diff);
  }
}
