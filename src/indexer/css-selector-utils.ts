export const HYPHEN = 45;
const OPEN_PAREN = 40;
const CLOSE_PAREN = 41;

/** `[A-Za-z0-9_-]`: the characters that continue a class token. */
export function isClassTokenChar(code: number): boolean {
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    (code >= 48 && code <= 57) ||
    code === HYPHEN ||
    code === 95
  );
}

/** Whitespace and the combinators `>+~`, indexed by char code. */
const COMBINATOR_CHARS = new Uint8Array(128);
for (const ch of " \t\n\r\f\v>+~") COMBINATOR_CHARS[ch.charCodeAt(0)] = 1;

/** Splits on commas at parenthesis depth 0. */
export function splitSelectorList(selector: string): string[] {
  if (!selector.includes(",")) {
    return [selector.trim()].filter(Boolean);
  }

  const selectors: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];

    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (char === "," && depth === 0) {
      selectors.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }

  selectors.push(selector.slice(start).trim());

  return selectors.filter(Boolean);
}

/** Drops `:not(...)` subtrees before class extraction. */
export function stripNotPseudoClasses(selector: string): string {
  let index = selector.indexOf(":not(");
  if (index === -1) return selector;

  let result = "";
  let start = 0;

  while (index !== -1) {
    result += selector.slice(start, index);

    // Skip past the parenthesis that closes this `:not(`.
    let depth = 1;
    let i = index + 5;
    for (; i < selector.length && depth > 0; i++) {
      const code = selector.charCodeAt(i);
      if (code === OPEN_PAREN) depth++;
      else if (code === CLOSE_PAREN) depth--;
    }

    start = i;
    index = selector.indexOf(":not(", start);
  }

  return result + selector.slice(start);
}

/**
 * Every `.bx--*` class token in a `:not(...)`-free selector, then every
 * legacy `.bx-*` token rewritten to `.bx--*`, deduplicated by first
 * occurrence. Scans by index: it runs on every selector in a Carbon theme.
 */
export function getCarbonClassesFromNormalized(normalized: string): string[] {
  let index = normalized.indexOf(".bx-");
  if (index === -1) return [];

  const classes: string[] = [];
  let legacy: string[] | undefined;
  const length = normalized.length;

  while (index !== -1) {
    const isCarbon = normalized.charCodeAt(index + 4) === HYPHEN;
    const tokenStart = isCarbon ? index + 5 : index + 4;
    let end = tokenStart;
    while (end < length && isClassTokenChar(normalized.charCodeAt(end))) {
      end++;
    }

    if (end > tokenStart) {
      if (isCarbon) {
        const cls = normalized.slice(index, end);
        if (!classes.includes(cls)) classes.push(cls);
      } else {
        const cls = `.bx--${normalized.slice(tokenStart, end)}`;
        legacy ??= [];
        if (!legacy.includes(cls)) legacy.push(cls);
      }
    }

    index = normalized.indexOf(".bx-", end);
  }

  if (legacy) {
    for (const cls of legacy) {
      if (!classes.includes(cls)) classes.push(cls);
    }
  }

  return classes;
}

/**
 * Offset where the subject compound starts in a `:not(...)`-free selector:
 * the last compound after a depth-0 combinator. Everything before it is the
 * ancestor compounds; `0` for a single compound.
 */
export function findSubjectStart(normalized: string): number {
  const length = normalized.length;
  let subjectStart = 0;
  let depth = 0;
  let start = 0;

  for (let i = 0; i <= length; i++) {
    const code = i < length ? normalized.charCodeAt(i) : -1;

    if (code === OPEN_PAREN) {
      depth++;
    } else if (code === CLOSE_PAREN) {
      if (depth > 0) depth--;
    } else if (
      i === length ||
      (depth === 0 && code < 128 && COMBINATOR_CHARS[code] === 1)
    ) {
      if (i > start) subjectStart = start;
      start = i + 1;
    }
  }

  return subjectStart;
}
