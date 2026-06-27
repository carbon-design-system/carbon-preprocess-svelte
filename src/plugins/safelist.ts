/** A safelist entry: a class selector matched literally, or a RegExp. */
export type SafelistEntry = string | RegExp;

/** Characters that continue a class token, so `.bx--grid` ≠ `.bx--grid-narrow`. */
const CLASS_TOKEN_CHAR = /[A-Za-z0-9_-]/;

/**
 * Whether `klass` appears as a complete class token in `selector`.
 *
 * `.bx--grid` matches `.bx--grid`, `.bx--grid:hover`, `div.bx--grid`, and
 * `.bx--grid .bx--row`, but not `.bx--grid-narrow` or `.bx--grid--wide`
 * (use a RegExp entry to keep BEM children).
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

/**
 * Whether a single selector is safelisted and must be kept regardless of the
 * importer-derived allowlist. String entries match a class token literally;
 * RegExp entries are tested against the whole selector.
 */
export function isSafelisted(
  selector: string,
  safelist: readonly SafelistEntry[],
): boolean {
  for (const entry of safelist) {
    if (typeof entry === "string") {
      if (hasClassToken(selector, entry)) return true;
    } else if (entry.test(selector)) {
      return true;
    }
  }

  return false;
}
