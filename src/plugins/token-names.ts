// Carbon token (`--cds-*`) names in sources, for svelte-prune's pruner.

const TOKEN_PREFIX = "--cds-";

// Matches a bare `--cds-` too, since code that builds names
// (`` `--cds-${name}` ``) names every token.
const TOKEN_LITERAL = /--cds-[A-Za-z0-9_-]*/g;

const RE_SCRIPT_OR_MARKUP = /\.(?:[cm]?js|html?|svg)(?:\?|$)/;

export function canNameTokens(id: string): boolean {
  return RE_SCRIPT_OR_MARKUP.test(id);
}

const VAR_READ = /var\(\s*(--cds-[A-Za-z0-9_-]+)/g;

export function collectTokenReads(css: string, into: Set<string>): void {
  if (!css.includes(TOKEN_PREFIX)) return;
  for (const match of css.matchAll(VAR_READ)) into.add(match[1]);
}

// svelte-prune's pruner keeps the custom properties its files name, so
// each name is written as `--cds-x`, and a bare `--cds-` (code that
// builds names) as a template that builds them.
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

// Names `source` only sets or removes (`setProperty`, `removeProperty`)
// go to `written` instead. The `includes` check is the fast path, since
// most code names no token.
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
