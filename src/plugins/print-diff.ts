import { BYTES_PER_KB, LOG_PREFIX } from "../constants";
import { byteLength } from "../utils";

export type AssetDiff = {
  id: string;
  originalCss: Uint8Array | string;
  optimizedCss: string;
};

let formatter: Intl.NumberFormat | undefined;

/**
 * `n` with at most two decimals. The formatter is made on first use: an
 * `Intl.NumberFormat` costs milliseconds, and every tool that loads
 * `svelte.config.js` imports this module.
 */
function format(n: number): string {
  formatter ??= new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  return formatter.format(n);
}

function toHumanReadableSize(bytes: number) {
  const kb = bytes / BYTES_PER_KB;
  return kb >= BYTES_PER_KB
    ? `${format(kb / BYTES_PER_KB)} MB`
    : `${format(kb)} kB`;
}

/**
 * One line for one asset, or `null` when its size is unchanged (no Carbon
 * CSS, or every component's styles were kept): the prefix, the file, and
 * its size before and after, then `note` if given.
 */
export function formatDiff(diff: AssetDiff, note?: string): string | null {
  const originalSize = byteLength(diff.originalCss);
  const optimizedSize = byteLength(diff.optimizedCss);
  if (originalSize === optimizedSize) return null;

  const original = toHumanReadableSize(originalSize);
  const optimized = toHumanReadableSize(optimizedSize);
  const percent = format(((originalSize - optimizedSize) / originalSize) * 100);
  const tail = note ? `, ${note}` : "";
  return `${LOG_PREFIX} ${diff.id} ${original} → ${optimized} (-${percent}%)${tail}`;
}

/**
 * Logs one asset's line through `log` (Vite's `config.logger.info`) when
 * set, else `console.log`, marked as a dry run on one. Returns whether it
 * logged anything.
 */
export function logAssetDiff(
  props: AssetDiff & {
    dryRun?: boolean;
    log?: (message: string) => void;
    note?: string;
  },
): boolean {
  const { dryRun, log = console.log, note, ...diff } = props;
  const line = formatDiff(diff, note);
  if (line === null) return false;
  log(
    dryRun
      ? line.replace(`${LOG_PREFIX} `, `${LOG_PREFIX} dry run, left as is: `)
      : line,
  );
  return true;
}
