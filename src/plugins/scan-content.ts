import { globSync, readFileSync } from "node:fs";
import path from "node:path";

/** Literal `bx--`-prefixed tokens as they appear in source markup. */
const CARBON_TOKEN = /bx--[A-Za-z0-9_-]+/g;

/**
 * Adds every literal `bx--` token in `source` to `into` as a class selector.
 * The `includes` check is the fast path: most modules contain no Carbon
 * token, and a substring search is far cheaper than the regex.
 */
export function collectCarbonTokens(source: string, into: Set<string>): void {
  if (!source.includes("bx--")) return;

  for (const token of source.match(CARBON_TOKEN) ?? []) {
    into.add(`.${token}`);
  }
}

/** Contents of each file in `files` (relative to `cwd`), skipping unreadable ones. */
export function* readSources(
  files: readonly string[],
  cwd: string,
): Generator<string> {
  for (const { code } of readFiles(files, cwd)) yield code;
}

/** Each readable file in `files` (relative to `cwd`), by absolute path. */
export function* readFiles(
  files: readonly string[],
  cwd: string,
): Generator<{ file: string; code: string }> {
  for (const file of files) {
    const absolute = path.resolve(cwd, file);
    try {
      yield { file: absolute, code: readFileSync(absolute, "utf-8") };
    } catch {
      // A directory or an unreadable match.
    }
  }
}

export type ContentScan = {
  /** Class selectors found (`.bx--grid`). */
  classes: string[];
  /** Files the globs matched (readable or not). */
  matchedFiles: number;
  /** Message from a glob failure, if any. */
  error?: string;
};

/**
 * Scans files matched by `content` globs (relative to `cwd`) for literal
 * `bx--` tokens. Also reports how many files matched and any glob failure so
 * callers can warn on a misconfigured `content`.
 *
 * For ``class={`bx--btn--${kind}`}`` only the prefix `bx--btn--` is found;
 * prefix matching then keeps `.bx--btn--primary` and similar.
 */
export function scanContent(
  content?: readonly string[],
  cwd: string = process.cwd(),
): ContentScan {
  if (!content || content.length === 0) return { classes: [], matchedFiles: 0 };

  let files: string[];
  try {
    files = globSync([...content], { cwd });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { classes: [], matchedFiles: 0, error };
  }

  const classes = new Set<string>();

  for (const source of readSources(files, cwd)) {
    collectCarbonTokens(source, classes);
  }

  return { classes: [...classes], matchedFiles: files.length };
}
