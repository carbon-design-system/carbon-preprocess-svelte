import type { ComponentIndex } from "../src/indexer/build-index";

/**
 * Human-readable summary of what changed between two component indexes:
 * components added or removed, paths that moved, and per component the
 * classes gained or lost. Since `src/component-index.ts` is stored packed,
 * its git diff no longer shows any of this; `bun run index:components`
 * prints these lines instead, which is what you want to read after a
 * Carbon bump.
 */
export function diffComponentIndex(
  before: ComponentIndex,
  after: ComponentIndex,
): string[] {
  const lines: string[] = [];
  const names = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].sort((a, b) => a.localeCompare(b));

  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const name of names) {
    const prev = before[name];
    const next = after[name];

    if (!prev) {
      lines.push(`+ ${name} (${next.path}, ${next.classes.length} classes)`);
      added += next.classes.length;
      changed++;
      continue;
    }

    if (!next) {
      lines.push(`- ${name} (${prev.path}, ${prev.classes.length} classes)`);
      removed += prev.classes.length;
      changed++;
      continue;
    }

    const prevClasses = new Set(prev.classes);
    const nextClasses = new Set(next.classes);
    const gained = next.classes.filter((cls) => !prevClasses.has(cls));
    const lost = prev.classes.filter((cls) => !nextClasses.has(cls));
    const moved = prev.path !== next.path;

    if (!moved && gained.length === 0 && lost.length === 0) continue;

    changed++;
    added += gained.length;
    removed += lost.length;
    lines.push(`~ ${name}`);
    if (moved) lines.push(`    path: ${prev.path} -> ${next.path}`);
    for (const cls of gained) lines.push(`    + ${cls}`);
    for (const cls of lost) lines.push(`    - ${cls}`);
  }

  if (changed === 0) return [];

  lines.push(
    `${changed} component${changed === 1 ? "" : "s"} changed: +${added} -${removed} classes`,
  );
  return lines;
}
