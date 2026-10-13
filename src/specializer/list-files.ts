import { readdir } from "node:fs/promises";
import path from "node:path";

const JS_OR_SVELTE = /\.(js|svelte)$/;

/**
 * Recursively lists `.js`/`.svelte` files under `root`, relative to `root`
 * with posix separators, sorted for a reproducible scan order.
 */
export async function listJsAndSvelteFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true });

  return entries
    .filter((entry) => JS_OR_SVELTE.test(entry))
    .map((entry) => entry.split(path.sep).join("/"))
    .sort((a, b) => a.localeCompare(b));
}
