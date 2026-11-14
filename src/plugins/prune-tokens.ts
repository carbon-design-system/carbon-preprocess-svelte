import { filterCss } from "caligula";

/** Carbon's design tokens: the custom properties its themes define. */
const TOKEN_PREFIX = "--cds-";

/**
 * A literal token name in source. Matches a bare `--cds-` too: code that
 * builds names (`` `--cds-${name}` ``) names every token.
 */
const TOKEN_LITERAL = /--cds-[A-Za-z0-9_-]*/g;

/** Emitted files that can name a token: scripts and markup. */
const RE_SCRIPT_OR_MARKUP = /\.(?:[cm]?js|html?|svg)(?:\?|$)/;

export function canNameTokens(id: string): boolean {
  return RE_SCRIPT_OR_MARKUP.test(id);
}

/** Token names a `var()` reads. */
const VAR_READ = /var\(\s*(--cds-[A-Za-z0-9_-]+)/g;

/**
 * Adds every literal `--cds-` name in `source` to `into`. The `includes`
 * check is the fast path: most code names no token.
 */
export function collectTokenNames(source: string, into: Set<string>): void {
  if (!source.includes(TOKEN_PREFIX)) return;
  for (const name of source.match(TOKEN_LITERAL) ?? []) into.add(name);
}

function addReads(value: string, into: Set<string>): void {
  if (!value.includes(TOKEN_PREFIX)) return;
  for (const match of value.matchAll(VAR_READ)) into.add(match[1]);
}

/** What one stylesheet reads, and what each token it defines reads. */
type TokenUsage = {
  reads: Set<string>;
  /** Token name to the tokens its values read. */
  definitions: Map<string, Set<string>>;
};

/** `undefined` if caligula can't read `css`, so its reads are unknown. */
function readTokenUsage(css: string): TokenUsage | undefined {
  const usage: TokenUsage = { reads: new Set(), definitions: new Map() };
  const { skipped } = filterCss(css, {
    atRule({ params }) {
      addReads(params, usage.reads);
    },
    decl({ prop, value }) {
      if (!prop.startsWith(TOKEN_PREFIX)) {
        addReads(value, usage.reads);
        return;
      }
      let reads = usage.definitions.get(prop);
      if (!reads) {
        reads = new Set();
        usage.definitions.set(prop, reads);
      }
      addReads(value, reads);
    },
  });
  return skipped ? undefined : usage;
}

/**
 * Whether `name` is named in `literals`, exactly or by a prefix ending in
 * `-` (`--cds-button-` from `` `--cds-button-${kind}` ``).
 */
function createLiteralCheck(literals: Iterable<string>) {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const literal of literals) {
    if (literal.endsWith("-")) prefixes.push(literal);
    else exact.add(literal);
  }
  return (name: string) =>
    exact.has(name) || prefixes.some((prefix) => name.startsWith(prefix));
}

/**
 * Removes the `--cds-` declarations nothing reads from each stylesheet in
 * `sheets`, which should be every CSS asset of one build: a token one asset
 * defines may be read in another. A token is read if a `var()` outside a
 * token declaration reads it, a read token's value reads it, or `literals`
 * (names found in the build's scripts and markup) name it. Leaves every
 * sheet unchanged if any can't be read. `removed` counts each sheet's
 * removed declarations.
 */
export function pruneUnusedTokens(
  sheets: readonly string[],
  literals: Iterable<string>,
): { css: string[]; removed: number[] } {
  const unchanged = { css: [...sheets], removed: sheets.map(() => 0) };
  if (!sheets.some((css) => css.includes(TOKEN_PREFIX))) return unchanged;

  const usages: TokenUsage[] = [];
  for (const css of sheets) {
    if (!css.includes(TOKEN_PREFIX)) continue;
    const usage = readTokenUsage(css);
    if (!usage) return unchanged;
    usages.push(usage);
  }

  const named = createLiteralCheck(literals);
  const definitions = new Map<string, Set<string>>();
  const read = new Set<string>();
  for (const usage of usages) {
    for (const name of usage.reads) read.add(name);
    for (const [name, reads] of usage.definitions) {
      const all = definitions.get(name);
      if (all) for (const r of reads) all.add(r);
      else definitions.set(name, new Set(reads));
      if (named(name)) read.add(name);
    }
  }
  const queue = [...read];
  while (queue.length > 0) {
    for (const name of definitions.get(queue.pop() as string) ?? []) {
      if (!read.has(name)) {
        read.add(name);
        queue.push(name);
      }
    }
  }

  const removed: number[] = [];
  const css = sheets.map((source) => {
    if (!source.includes(TOKEN_PREFIX)) {
      removed.push(0);
      return source;
    }
    const result = filterCss(source, {
      decl: ({ prop }) => !prop.startsWith(TOKEN_PREFIX) || read.has(prop),
    });
    removed.push(result.removed);
    return result.css;
  });
  return { css, removed };
}
