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

// A token a script only sets or removes inline
// (`style.setProperty(`--cds-${name}`, value)`, as Carbon's `Theme` does)
// needs no declaration: the inline value stands on its own, and a read
// anywhere keeps the declaration anyway. Matches minified code too.
const TOKEN_WRITE = /\.(?:set|remove)Property\(\s*[`'"](--cds-[A-Za-z0-9_-]*)/g;

/**
 * Adds every literal `--cds-` name in `source` to `into`, except those it
 * only sets or removes with `setProperty` or `removeProperty`, which go
 * to `written`. The `includes` check is the fast path: most code names
 * no token.
 */
export function collectTokenNames(
  source: string,
  into: Set<string>,
  written?: Set<string>,
): void {
  if (!source.includes(TOKEN_PREFIX)) return;
  const reads = source.replace(TOKEN_WRITE, (write: string, name: string) => {
    written?.add(name);
    return write.slice(0, -name.length);
  });
  for (const name of reads.match(TOKEN_LITERAL) ?? []) into.add(name);
}
