import { globSync, readFileSync } from "node:fs";

/** Literal `bx--`-prefixed tokens as they appear in source markup. */
const CARBON_TOKEN = /bx--[A-Za-z0-9_-]+/g;

/**
 * Add every literal `bx--` token in `source` to `into` as a class selector.
 * Shared by the `content` glob scan and the bundler module scan. The
 * `includes` check is the fast path: most modules (vendor code, app logic)
 * contain no Carbon token, and a substring search is far cheaper than
 * running the regex.
 */
export function collectCarbonTokens(source: string, into: Set<string>): void {
  if (!source.includes("bx--")) return;

  for (const token of source.match(CARBON_TOKEN) ?? []) {
    into.add(`.${token}`);
  }
}

/**
 * Scan files matched by `content` globs for literal `bx--`-prefixed tokens.
 * Returns them as class selectors (`.bx--token`).
 *
 * For ``class={`bx--btn--${kind}`}``, the importer-based allowlist only sees
 * the prefix in your source (`bx--btn--`). Prefix matching then keeps
 * `.bx--btn--primary` and similar at runtime.
 *
 * Globs resolve relative to the current working directory. Returns an empty
 * array when `content` is omitted or globbing fails.
 */
export function scanContentClasses(content?: readonly string[]): string[] {
  if (!content || content.length === 0) return [];

  let files: string[];
  try {
    files = globSync([...content]);
  } catch {
    return [];
  }

  const classes = new Set<string>();

  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, "utf-8");
    } catch {
      // Skip directories and unreadable matches.
      continue;
    }

    collectCarbonTokens(source, classes);
  }

  return [...classes];
}
