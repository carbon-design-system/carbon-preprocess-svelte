import type { AtRule, Rule } from "postcss";
import { components } from "../component-index";
import {
  ALWAYS_ON_CLASSES,
  CARBON_PREFIX,
  CONTEXT_ANCESTORS,
} from "../constants";
import { isSafelisted, type SafelistEntry } from "./safelist";

const CARBON_CLASS = /\.bx--[A-Za-z0-9_-]+/g;
const SELECTOR_COMBINATOR = /[\s>+~]/;
const LEGACY_CARBON_CLASS = /\.bx-(?!-)[A-Za-z0-9_-]+/g;
const LEGACY_CARBON_PREFIX = /bx-(?!-)/;
const BEM_PREFIXES = ["--", "__"];
const FLATPICKR_CLASS_NAMES = [
  "dayContainer",
  "numInputWrapper",
  "numInput",
  "cur-month",
  "arrowUp",
  "arrowDown",
  "prevMonthDay",
  "nextMonthDay",
  "startRange",
  "endRange",
  "inRange",
  "noCalendar",
  "hasTime",
  "hasWeeks",
  "showTimeInput",
  "slideLeft",
  "slideLeftNew",
  "slideRight",
  "slideRightNew",
];
const FLATPICKR_SELECTOR = new RegExp(
  `\\.(?:flatpickr-[A-Za-z0-9_-]+|${FLATPICKR_CLASS_NAMES.join("|")})(?![A-Za-z0-9_-])`,
);
const FLATPICKR_KEYFRAMES = new Set(["fpFadeInDown"]);
const EXACT_ONLY_CLASSES = new Set(ALWAYS_ON_CLASSES);
const CONTEXT_ANCESTOR_SET = new Set<string>(CONTEXT_ANCESTORS);
const SHARED_CLASSES = getSharedClasses();

export type StrictCssOptimizerOptions = {
  allowlist: Set<string>;
  preserveFlatpickr: boolean;
  safelist: readonly SafelistEntry[];
};

function getSharedClasses(): Set<string> {
  const counts = new Map<string, number>();

  for (const component of Object.values(components)) {
    for (const cls of new Set(component.classes)) {
      counts.set(cls, (counts.get(cls) ?? 0) + 1);
    }
  }

  return new Set(
    [...counts].filter(([, count]) => count > 1).map(([cls]) => cls),
  );
}

/**
 * Split on commas at parenthesis depth 0 so `:is(.a, .b)` stays one selector.
 */
function splitSelectorList(selector: string): string[] {
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

/**
 * Drop `:not(...)` subtrees before class extraction. Negated classes are
 * exclusions, not part of the positive match (e.g. header global buttons
 * vs `.bx--header-search-button`).
 */
function stripNotPseudoClasses(selector: string): string {
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

/**
 * Split a selector branch into ancestor compounds and the subject compound.
 */
function splitSelectorParts(
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

function getCarbonClasses(selector: string): string[] {
  const normalized = stripNotPseudoClasses(selector);
  const classes = normalized.match(CARBON_CLASS) ?? [];
  const legacyClasses = (normalized.match(LEGACY_CARBON_CLASS) ?? []).map(
    (cls) => cls.replace(".bx-", ".bx--"),
  );

  return [...new Set([...classes, ...legacyClasses])];
}

type AllowlistMatch = { matched: true; shared: boolean } | { matched: false };

function matchesAllowlist(
  name: string,
  allowlist: Set<string>,
): AllowlistMatch {
  if (allowlist.has(name)) {
    return { matched: true, shared: SHARED_CLASSES.has(name) };
  }

  for (const selector of allowlist) {
    if (EXACT_ONLY_CLASSES.has(selector)) continue;

    const shared = SHARED_CLASSES.has(selector);
    if (selector.endsWith("-") && name.startsWith(selector)) {
      return { matched: true, shared };
    }

    if (shared) continue;

    if (
      BEM_PREFIXES.some((prefix) => name.startsWith(`${selector}${prefix}`))
    ) {
      return { matched: true, shared: false };
    }
  }

  return { matched: false };
}

function classMatchesAllowlist(name: string, allowlist: Set<string>): boolean {
  return (
    CONTEXT_ANCESTOR_SET.has(name) || matchesAllowlist(name, allowlist).matched
  );
}

/**
 * Whether to keep this selector in strict mode.
 *
 * Allowlist hits use Set lookup; otherwise prefix-match BEM children
 * (`.bx--btn--primary`, `.bx--btn__icon`).
 *
 * Descendant selectors require every subject class to match. Ancestor classes
 * may match CONTEXT_ANCESTORS without being imported. Same-element compounds
 * still require every class to match.
 */
function shouldKeepSelector(selector: string, allowlist: Set<string>): boolean {
  const classes = getCarbonClasses(selector);
  if (classes.length === 0) return true;

  const parts = splitSelectorParts(selector);

  if (!parts) {
    return classes.every((name) => matchesAllowlist(name, allowlist).matched);
  }

  const subjectClasses = getCarbonClasses(parts.subject);
  const ancestorClasses = parts.ancestors.flatMap((part) =>
    getCarbonClasses(part),
  );

  if (
    subjectClasses.length > 0 &&
    !subjectClasses.every((name) => matchesAllowlist(name, allowlist).matched)
  ) {
    return false;
  }

  return ancestorClasses.every((name) =>
    classMatchesAllowlist(name, allowlist),
  );
}

/**
 * Returns the number of Carbon selectors removed: the full selector count when
 * the whole rule is dropped, the pruned count when a comma list is trimmed, or
 * `0` when nothing changed.
 */
export function optimizeStrictRule(
  node: Rule,
  options: StrictCssOptimizerOptions,
): number {
  const { allowlist, preserveFlatpickr, safelist } = options;
  const selector = node.selector;

  if (
    !(
      CARBON_PREFIX.test(selector) ||
      LEGACY_CARBON_PREFIX.test(selector) ||
      FLATPICKR_SELECTOR.test(selector)
    )
  ) {
    return 0;
  }

  const selectors = splitSelectorList(selector);
  const keptSelectors = selectors.filter((selectee) => {
    if (isSafelisted(selectee, safelist)) {
      return true;
    }

    if (FLATPICKR_SELECTOR.test(selectee) && !preserveFlatpickr) {
      return false;
    }

    return (
      !(CARBON_PREFIX.test(selectee) || LEGACY_CARBON_PREFIX.test(selectee)) ||
      shouldKeepSelector(selectee, allowlist)
    );
  });

  if (keptSelectors.length === 0) {
    node.remove();
    return selectors.length;
  }

  if (keptSelectors.length < selectors.length) {
    node.selector = keptSelectors.join(", ");
    return selectors.length - keptSelectors.length;
  }

  return 0;
}

/**
 * Returns `1` when the flatpickr keyframes node is removed, otherwise `0`.
 */
export function optimizeStrictAtRule(
  node: AtRule,
  options: Pick<StrictCssOptimizerOptions, "preserveFlatpickr">,
): number {
  if (
    !options.preserveFlatpickr &&
    node.name === "keyframes" &&
    FLATPICKR_KEYFRAMES.has(node.params)
  ) {
    node.remove();
    return 1;
  }

  return 0;
}
