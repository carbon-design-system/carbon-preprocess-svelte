import { readdir } from "node:fs/promises";
import path from "node:path";

const JS_OR_SVELTE = /\.(js|svelte)$/;

/**
 * Recursively lists `.js`/`.svelte` files under `root`, relative to `root`
 * with posix separators. Node-native replacement for Bun's
 * `new Glob("**\/*.{js,svelte}").scan(root)`.
 */
export async function listJsAndSvelteFiles(root: string): Promise<string[]> {
  // Final result is sorted below, so directory traversal order (and thus
  // resolution order of these concurrent recursive calls) can't affect it --
  // safe to parallelize per directory.
  async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });

    const nested = await Promise.all(
      entries.map((entry) => {
        const absolute = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          return walk(absolute);
        }

        if (entry.isFile() && JS_OR_SVELTE.test(entry.name)) {
          const relative = path
            .relative(root, absolute)
            .split(path.sep)
            .join("/");
          return [relative];
        }

        return [];
      }),
    );

    return nested.flat();
  }

  const results = await walk(root);
  // Directory read order isn't guaranteed across platforms/filesystems;
  // sort for a deterministic, reproducible scan order.
  return results.sort((a, b) => a.localeCompare(b));
}
