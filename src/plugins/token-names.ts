/** Carbon token (`--cds-*`) names in sources, for svelte-prune's pruner. */

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
 * Adds the token names stylesheet `css` reads (`var(--cds-x)`) to `into`,
 * not the ones it only defines.
 */
export function collectTokenReads(css: string, into: Set<string>): void {
  if (!css.includes(TOKEN_PREFIX)) return;
  for (const match of css.matchAll(VAR_READ)) into.add(match[1]);
}

/**
 * The names in `names` as a file for svelte-prune's pruner, which keeps
 * the custom properties its files name: `--cds-x`, and for a bare `--cds-`
 * (code that builds names), a template that builds them.
 */
export function tokenNamesFile(names: Iterable<string>): { code: string } {
  const lines: string[] = [];
  for (const name of new Set(names)) {
    lines.push(name === TOKEN_PREFIX ? `\`${name}\${name}\`` : name);
  }
  return { code: lines.join("\n") };
}

/**
 * Adds every literal `--cds-` name in `source` to `into`. The `includes`
 * check is the fast path: most code names no token.
 */
export function collectTokenNames(source: string, into: Set<string>): void {
  if (!source.includes(TOKEN_PREFIX)) return;
  for (const name of source.match(TOKEN_LITERAL) ?? []) into.add(name);
}
