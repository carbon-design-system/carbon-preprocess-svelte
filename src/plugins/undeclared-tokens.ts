import { filterCss } from "caligula";

const TOKEN_PREFIX = "--cds-";

// The second group catches a fallback's `,`: a read with one never
// resolves to nothing, so it can't be reported.
const VAR_READ = /var\(\s*(--cds-[A-Za-z0-9_-]+)\s*(,?)/g;

/** What a set of stylesheets reads and declares. */
type TokenUse = {
  /** Read outside a token's own declaration. */
  reads: Set<string>;
  /** Of `reads`, those without a fallback. */
  bare: Set<string>;
  /** Each declared token, to the tokens its values read, and which bare. */
  declared: Map<string, { reads: Set<string>; bare: Set<string> }>;
};

function addReads(value: string, reads: Set<string>, bare: Set<string>) {
  if (!value.includes(TOKEN_PREFIX)) return;
  for (const [, name, fallback] of value.matchAll(VAR_READ)) {
    reads.add(name);
    if (!fallback) bare.add(name);
  }
}

// `undefined` when caligula can't read a sheet: its reads are unknown, so
// reporting the rest could name a token that sheet declares.
function readTokenUse(sheets: readonly string[]): TokenUse | undefined {
  const use: TokenUse = {
    reads: new Set(),
    bare: new Set(),
    declared: new Map(),
  };
  for (const css of sheets) {
    if (!css.includes(TOKEN_PREFIX)) continue;
    const { skipped } = filterCss(css, {
      atRule({ params }) {
        addReads(params, use.reads, use.bare);
        return undefined;
      },
      decl({ prop, value }) {
        if (!prop.startsWith(TOKEN_PREFIX)) {
          addReads(value, use.reads, use.bare);
          return undefined;
        }
        let entry = use.declared.get(prop);
        if (!entry) {
          entry = { reads: new Set(), bare: new Set() };
          use.declared.set(prop, entry);
        }
        addReads(value, entry.reads, entry.bare);
        return undefined;
      },
    });
    if (skipped) return undefined;
  }
  return use;
}

// The Carbon tokens `sheets` read without a fallback that none of them
// declares, so they resolve to nothing: most often a v10 name Carbon
// renamed. A token the build's scripts or markup name (`named`) is left
// out, since code may set it at run time, and so is every token when one
// of them builds names (a bare `--cds-`, or a prefix such as
// `--cds-button-`). Sheets that declare no token at all load Carbon's
// themes some other way, so they get none either.
export function findUndeclaredTokens(
  sheets: readonly string[],
  named: Iterable<string>,
): string[] {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const name of named) {
    if (name.endsWith("-")) prefixes.push(name);
    else exact.add(name);
  }
  if (prefixes.includes(TOKEN_PREFIX)) return [];

  const use = readTokenUse(sheets);
  if (!use || use.declared.size === 0) return [];

  // A declared token's own reads count only once something reads it,
  // since an unread declaration ships no value.
  const queue = [...use.reads];
  const seen = new Set(queue);
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    const entry = use.declared.get(name);
    if (!entry) continue;
    for (const read of entry.bare) use.bare.add(read);
    for (const read of entry.reads) {
      if (!seen.has(read)) {
        seen.add(read);
        queue.push(read);
      }
    }
  }
  return [...use.bare]
    .filter(
      (name) =>
        !use.declared.has(name) &&
        !exact.has(name) &&
        !prefixes.some((prefix) => name.startsWith(prefix)),
    )
    .sort();
}
