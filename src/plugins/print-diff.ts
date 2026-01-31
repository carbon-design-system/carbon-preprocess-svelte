import { BITS_DENOM } from "../constants";

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
  return a.length > b.length ? a : a.padStart(b.length, " ");
}

/**
 * Prints a formatted summary of CSS optimization results to the console.
 *
 * Shows the original and optimized file sizes with percentage reduction.
 * Silently returns if no size change occurred (e.g., when the CSS contains
 * no Carbon styles or all Carbon components are in use).
 */
export function printDiff(props: {
  original_css: Uint8Array | Buffer | string;
  optimized_css: string;
  id: string;
}) {
  const { original_css, optimized_css, id } = props;

  const original_size = stringSizeInKB(original_css.toString());
  const optimized_size = stringSizeInKB(optimized_css);

  /**
   * Skip output when sizes are equal—this indicates either no Carbon CSS
   * was present, or all detected components' styles were preserved.
   */
  if (original_size === optimized_size) {
    return;
  }

  const original = toHumanReadableSize(original_size);
  const optimized = toHumanReadableSize(optimized_size);
  const original_display = padIfNeeded(original, optimized);
  const optimized_display = padIfNeeded(optimized, original);
  const diff = percentageDiff(original_size, optimized_size);

  console.log("\n");
  console.log("Optimized", id);
  console.log("Before:", original_display);
  console.log("After: ", optimized_display, `(-${diff})\n`);
}
