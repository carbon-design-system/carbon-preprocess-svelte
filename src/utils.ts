import { BITS_DENOM } from "./constants";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export const log = console.log;

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
