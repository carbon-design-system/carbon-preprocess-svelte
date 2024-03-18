import { BITS_DENOM } from "./constants";

export const noop = () => {};

export const log = console.log;

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function toHumanReadableSize(size_in_kb: number) {
  if (size_in_kb >= BITS_DENOM) {
    return formatter.format(size_in_kb / BITS_DENOM) + " MB";
  }

  return formatter.format(size_in_kb) + " kB";
}

export function stringSizeInKB(str: string) {
  const blob = new Blob([str], { type: "text/plain" });
  return blob.size / BITS_DENOM;
}

export function percentageDiff(a: number, b: number) {
  return formatter.format(((a - b) / a) * 100) + "%";
}

export function logComparison(props: {
  original_size: number;
  optimized_size: number;
  id: string;
}) {
  const { original_size, optimized_size, id } = props;
  const original = toHumanReadableSize(original_size);
  const optimized = toHumanReadableSize(optimized_size);
  const diff = percentageDiff(original_size, optimized_size);

  log("\n");
  log("Optimized", id);
  log("Before:", original);
  log("After: ", optimized.padStart(original.length, " "), `(-${diff})\n`);
}
