import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { resolveCarbonRoot } from "../indexer/resolve-carbon-root";

/** A class in a stylesheet, `\:` escapes included (`.bx--lg\:col-span-4`). */
const CLASS = /\.(bx--(?:[\w-]|\\:)+)/g;
/** Every theme defines the same classes: one stylesheet lists them. */
const STYLESHEETS = ["css/all.css", "css/white.css"];

const cache = new Map<string, { mtimeMs: number; classes: string[] }>();

/**
 * The `bx--` classes the installed Carbon's stylesheet defines
 * (`.bx--btn`), for what the pruning depends on; `[]` if it can't be read.
 */
export function carbonStylesheetClasses(root: string): readonly string[] {
  let carbonRoot: string;
  try {
    carbonRoot = resolveCarbonRoot(root);
  } catch {
    return [];
  }
  const file = STYLESHEETS.map((name) => path.join(carbonRoot, name)).find(
    existsSync,
  );
  if (!file) return [];
  const { mtimeMs } = statSync(file);
  const cached = cache.get(file);
  if (cached?.mtimeMs === mtimeMs) return cached.classes;
  const classes = new Set<string>();
  for (const [, cls] of readFileSync(file, "utf8").matchAll(CLASS)) {
    classes.add(`.${cls.replaceAll("\\:", ":")}`);
  }
  const sorted = [...classes].sort();
  cache.set(file, { mtimeMs, classes: sorted });
  return sorted;
}
