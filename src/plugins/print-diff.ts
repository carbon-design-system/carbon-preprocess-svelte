import { BYTES_PER_KB } from "../constants";
import { byteLength } from "../utils";

export type AssetDiff = {
  id: string;
  originalCss: Uint8Array | string;
  optimizedCss: string;
};

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function toHumanReadableSize(bytes: number) {
  const kb = bytes / BYTES_PER_KB;
  return kb >= BYTES_PER_KB
    ? `${formatter.format(kb / BYTES_PER_KB)} MB`
    : `${formatter.format(kb)} kB`;
}

/**
 * The size block for one asset, or `null` when its size is unchanged (no
 * Carbon CSS, or every component's styles were kept). One string lets a host
 * logger (Vite's `config.logger`) emit it as a single message.
 */
export function formatDiff(diff: AssetDiff): string | null {
  const originalSize = byteLength(diff.originalCss);
  const optimizedSize = byteLength(diff.optimizedCss);
  if (originalSize === optimizedSize) return null;

  const original = toHumanReadableSize(originalSize);
  const optimized = toHumanReadableSize(optimizedSize);
  const width = Math.max(original.length, optimized.length);
  const percent = formatter.format(
    ((originalSize - optimizedSize) / originalSize) * 100,
  );

  return `\n\nOptimized ${diff.id}\nBefore: ${original.padStart(width)}\nAfter:  ${optimized.padStart(width)} (-${percent}%)\n`;
}

/**
 * Logs the dry-run notice and size block for one asset, through `log` (Vite's
 * `config.logger.info`) when set, else `console.log`.
 */
export function logAssetDiff(
  props: AssetDiff & { dryRun?: boolean; log?: (message: string) => void },
): void {
  const { dryRun, log = console.log, ...diff } = props;

  if (dryRun) log(`Dry run: ${diff.id} left unchanged`);

  const block = formatDiff(diff);
  if (block !== null) log(block);
}
