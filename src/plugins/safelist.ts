/** A safelist entry: a class selector matched literally, or a RegExp. */
export type SafelistEntry = string | RegExp;

/** Characters that continue a class token, so `.bx--grid` ≠ `.bx--grid-narrow`. */
const CLASS_TOKEN_CHAR = /[A-Za-z0-9_-]/;

/**
 * Whether `klass` appears as a complete class token in `selector`: `.bx--grid`
 * matches `.bx--grid:hover` and `div.bx--grid` but not `.bx--grid-narrow`.
 */
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

/**
 * Whether a selector must be kept regardless of the allowlist. Strings match
 * a class token literally; RegExps are tested against the whole selector.
 */
export function isSafelisted(
  selector: string,
  safelist: readonly SafelistEntry[],
): boolean {
  return safelist.some((entry) => matches(selector, entry));
}
