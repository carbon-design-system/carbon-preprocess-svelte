import type { AtRule, Rule } from "postcss";
import { components } from "../component-index";
import { CARBON_PREFIX } from "../constants";

const CARBON_CLASS = /\.bx--[A-Za-z0-9_-]+/g;
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
const SHARED_CLASSES = getSharedClasses();

export type StrictCssOptimizerOptions = {
  allowlist: Set<string>;
  preserveFlatpickr: boolean;
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

function getCarbonClasses(selector: string): string[] {
  const classes = selector.match(CARBON_CLASS) ?? [];
  const legacyClasses = (selector.match(LEGACY_CARBON_CLASS) ?? []).map((cls) =>
    cls.replace(".bx-", ".bx--"),
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

/**
 * Whether to keep this selector in strict mode.
 *
 * Allowlist hits use Set lookup; otherwise prefix-match BEM children
 * (`.bx--btn--primary`, `.bx--btn__icon`).
 *
 * Shared classes like `.bx--skeleton` only count if every Carbon class in
 * the selector is allowed, so Button imports do not pull in Tabs skeleton rules.
 */
function shouldKeepSelector(selector: string, allowlist: Set<string>): boolean {
  const classes = getCarbonClasses(selector);
  if (classes.length === 0) return true;

  let hasMatch = false;

  for (const name of classes) {
    const match = matchesAllowlist(name, allowlist);
    if (!match.matched) continue;
    if (!match.shared) return true;
    hasMatch = true;
  }

  return (
    hasMatch &&
    classes.every((name) => matchesAllowlist(name, allowlist).matched)
  );
}

export function optimizeStrictRule(
  node: Rule,
  options: StrictCssOptimizerOptions,
): void {
  const { allowlist, preserveFlatpickr } = options;
  const selector = node.selector;

  if (
    !(
      CARBON_PREFIX.test(selector) ||
      LEGACY_CARBON_PREFIX.test(selector) ||
      FLATPICKR_SELECTOR.test(selector)
    )
  ) {
    return;
  }

  const selectors = splitSelectorList(selector);
  const keptSelectors = selectors.filter((selectee) => {
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
  } else if (keptSelectors.length < selectors.length) {
    node.selector = keptSelectors.join(", ");
  }
}

export function optimizeStrictAtRule(
  node: AtRule,
  options: Pick<StrictCssOptimizerOptions, "preserveFlatpickr">,
): void {
  if (
    !options.preserveFlatpickr &&
    node.name === "keyframes" &&
    FLATPICKR_KEYFRAMES.has(node.params)
  ) {
    node.remove();
  }
}
