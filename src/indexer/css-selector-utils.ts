const CARBON_CLASS = /\.bx--[A-Za-z0-9_-]+/g;
const LEGACY_CARBON_CLASS = /\.bx-(?!-)[A-Za-z0-9_-]+/g;
// Matches `/[\s>+~]/`'s practical range for selector text: whitespace plus
// the three combinator symbols. Checked per-character in a hot loop below,
// so a Set lookup replaces a regex call.
const COMBINATOR_CHARS = new Set([
  " ",
  "\t",
  "\n",
  "\r",
  "\f",
  "\v",
  ">",
  "+",
  "~",
]);

/** Split on commas at parenthesis depth 0. */
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

/** Drop `:not(...)` subtrees before class extraction. */
function stripNotPseudoClasses(selector: string): string {
  let index = selector.indexOf(":not(");
  if (index === -1) return selector;

  let result = "";
  let start = 0;

  while (index !== -1) {
    result += selector.slice(start, index);

    // Skip to just past the parenthesis that closes this `:not(`.
    let depth = 1;
    let i = index + 5;
    for (; i < selector.length && depth > 0; i++) {
      if (selector[i] === "(") depth++;
      else if (selector[i] === ")") depth--;
    }

    start = i;
    index = selector.indexOf(":not(", start);
  }

  return result + selector.slice(start);
}

/** `normalized` must already be free of `:not(...)` subtrees. */
export function getCarbonClassesFromNormalized(normalized: string): string[] {
  if (!normalized.includes(".bx-")) return [];

  const classes = normalized.match(CARBON_CLASS) ?? [];
  const legacyClasses = (normalized.match(LEGACY_CARBON_CLASS) ?? []).map(
    (cls) => cls.replace(".bx-", ".bx--"),
  );

  return [...new Set([...classes, ...legacyClasses])];
}

/** Split a selector branch into ancestor compounds and the subject compound. */
export function splitSelectorParts(selector: string): {
  ancestors: string[];
  subject: string;
} {
  const normalized = stripNotPseudoClasses(selector);
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  const pushPart = (end: number) => {
    const part = normalized.slice(start, end).trim();
    if (part) parts.push(part);
  };

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && COMBINATOR_CHARS.has(char)) {
      pushPart(i);
      start = i + 1;
    }
  }

  pushPart(normalized.length);

  if (parts.length <= 1) {
    return {
      ancestors: [],
      subject: parts[0] ?? normalized,
    };
  }

  return {
    ancestors: parts.slice(0, -1),
    subject: parts[parts.length - 1],
  };
}
