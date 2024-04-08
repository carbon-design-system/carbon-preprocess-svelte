import { BITS_DENOM } from "../constants";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function toHumanReadableSize(size_in_kb: number) {
  if (size_in_kb >= BITS_DENOM) {
    return formatter.format(size_in_kb / BITS_DENOM) + " MB";
  }

  return formatter.format(size_in_kb) + " kB";
}

function percentageDiff(a: number, b: number) {
  return formatter.format(((a - b) / a) * 100) + "%";
}

function stringSizeInKB(str: string) {
  const blob = new Blob([str], { type: "text/plain" });
  return blob.size / BITS_DENOM;
}

function padIfNeeded(a: string, b: string) {
  return a.length > b.length ? a : a.padStart(b.length, " ");
}

export function printDiff(props: {
  original_css: Uint8Array | Buffer | string;
  optimized_css: string;
  id: string;
}) {
  const { original_css, optimized_css, id } = props;

  const original_size = stringSizeInKB(original_css.toString());
  const optimized_size = stringSizeInKB(optimized_css);
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
