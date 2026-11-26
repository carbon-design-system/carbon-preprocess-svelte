/** A safelist entry: a class selector matched literally, or a RegExp. */
export type SafelistEntry = string | RegExp;

// Characters that continue a class token, so `.bx--grid`
// ≠ `.bx--grid-narrow`.
const CLASS_TOKEN_CHAR = /[A-Za-z0-9_-]/;

// A complete token only, so `.bx--grid` matches `.bx--grid:hover` and
// `div.bx--grid` but not `.bx--grid-narrow`.
function hasClassToken(selector: string, klass: string): boolean {
  let from = 0;

  for (;;) {
    const index = selector.indexOf(klass, from);
    if (index === -1) return false;

    const next = selector[index + klass.length];
    if (next === undefined || !CLASS_TOKEN_CHAR.test(next)) return true;

    from = index + 1;
  }
}

function matches(selector: string, entry: SafelistEntry): boolean {
  if (typeof entry === "string") return hasClassToken(selector, entry);
  // A `g`/`y` RegExp carries `lastIndex` between `test` calls.
  entry.lastIndex = 0;
  return entry.test(selector);
}

// Strings match a class token literally, and RegExps the whole selector,
// so a string entry never keeps a longer class (`.bx--grid-narrow`
// for `.bx--grid`).
export function isSafelisted(
  selector: string,
  safelist: readonly SafelistEntry[],
): boolean {
  return safelist.some((entry) => matches(selector, entry));
}
