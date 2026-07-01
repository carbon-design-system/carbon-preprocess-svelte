const CARBON_CLASS = /\.bx--[A-Za-z0-9_-]+/g;
const LEGACY_CARBON_CLASS = /\.bx-(?!-)[A-Za-z0-9_-]+/g;
const SELECTOR_COMBINATOR = /[\s>+~]/;

/** Split on commas at parenthesis depth 0. */
export function splitSelectorList(selector: string): string[] {
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
export function stripNotPseudoClasses(selector: string): string {
  let result = "";
  let notDepth = 0;

  for (let i = 0; i < selector.length; i++) {
    if (
      notDepth === 0 &&
      selector[i] === ":" &&
      selector.startsWith(":not(", i)
    ) {
      notDepth = 1;
      i += 4;
      continue;
    }

    if (notDepth > 0) {
      if (selector[i] === "(") notDepth++;
      else if (selector[i] === ")") notDepth--;
      continue;
    }

    result += selector[i];
  }

  return result;
}

export function getCarbonClasses(selector: string): string[] {
  const normalized = stripNotPseudoClasses(selector);
  const classes = normalized.match(CARBON_CLASS) ?? [];
  const legacyClasses = (normalized.match(LEGACY_CARBON_CLASS) ?? []).map(
    (cls) => cls.replace(".bx-", ".bx--"),
  );

  return [...new Set([...classes, ...legacyClasses])];
}

/** Split a selector branch into ancestor compounds and the subject compound. */
export function splitSelectorParts(
  selector: string,
): { ancestors: string[]; subject: string } | null {
  const normalized = stripNotPseudoClasses(selector);
  const parts: string[] = [];
  let current = "";
  let depth = 0;

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && SELECTOR_COMBINATOR.test(char)) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  if (parts.length <= 1) {
    return null;
  }

  return {
    ancestors: parts.slice(0, -1),
    subject: parts[parts.length - 1],
  };
}
