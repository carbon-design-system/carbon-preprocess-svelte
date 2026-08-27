import type { AtRule, Rule } from "postcss";
import { getComponents } from "../component-index-registry";
import {
  ALWAYS_ON_CLASSES,
  CARBON_PREFIX,
  CONTEXT_ANCESTORS,
} from "../constants";
import {
  getCarbonClassesFromNormalized,
  splitSelectorList,
  splitSelectorParts,
} from "../indexer/css-selector-utils";
import { isSafelisted, type SafelistEntry } from "./safelist";

const LEGACY_CARBON_PREFIX = /bx-(?!-)/;
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

export type StrictCssOptimizerOptions = {
  allowlist: Set<string>;
  preserveFlatpickr: boolean;
  safelist: readonly SafelistEntry[];
};

let sharedClassesFor: ReturnType<typeof getComponents> | undefined;
let sharedClassesCache: Set<string> | undefined;

function getSharedClasses(): Set<string> {
  const components = getComponents();
  if (sharedClassesCache && sharedClassesFor === components) {
    return sharedClassesCache;
  }

  const counts = new Map<string, number>();

  for (const component of Object.values(components)) {
    for (const cls of component.classes) {
      counts.set(cls, (counts.get(cls) ?? 0) + 1);
    }
  }

  sharedClassesFor = components;
  sharedClassesCache = new Set(
    [...counts].filter(([, count]) => count > 1).map(([cls]) => cls),
  );

  return sharedClassesCache;
}

type AllowlistIndex = {
  exact: Set<string>;
  hyphenPrefixes: string[];
  shared: Set<string>;
};

const allowlistIndexCache = new WeakMap<Set<string>, AllowlistIndex>();

function getAllowlistIndex(allowlist: Set<string>): AllowlistIndex {
  const cached = allowlistIndexCache.get(allowlist);
  if (cached) return cached;

  const shared = getSharedClasses();
  const hyphenPrefixes: string[] = [];

  for (const selector of allowlist) {
    if (EXACT_ONLY_CLASSES.has(selector)) continue;
    if (selector.endsWith("-")) {
      hyphenPrefixes.push(selector);
    }
  }

  const index = { exact: allowlist, hyphenPrefixes, shared };
  allowlistIndexCache.set(allowlist, index);
  return index;
}

function matchesAllowlist(name: string, index: AllowlistIndex): boolean {
  if (index.exact.has(name)) return true;

  for (const prefix of index.hyphenPrefixes) {
    if (name.startsWith(prefix)) return true;
  }

  for (let i = 1; i < name.length - 1; i++) {
    const a = name[i];
    const b = name[i + 1];
    if (!((a === "-" && b === "-") || (a === "_" && b === "_"))) continue;

    const parent = name.slice(0, i);
    if (
      !EXACT_ONLY_CLASSES.has(parent) &&
      index.exact.has(parent) &&
      !index.shared.has(parent)
    ) {
      return true;
    }
  }

  return false;
}

function classMatchesAllowlist(name: string, index: AllowlistIndex): boolean {
  return CONTEXT_ANCESTOR_SET.has(name) || matchesAllowlist(name, index);
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
function shouldKeepSelector(selector: string, index: AllowlistIndex): boolean {
  const parts = splitSelectorParts(selector);
  const subjectClasses = getCarbonClassesFromNormalized(parts.subject);
  const ancestorClasses = parts.ancestors.flatMap((part) =>
    getCarbonClassesFromNormalized(part),
  );

  if (subjectClasses.length === 0 && ancestorClasses.length === 0) {
    return true;
  }

  if (ancestorClasses.length === 0) {
    return subjectClasses.every((name) => matchesAllowlist(name, index));
  }

  if (
    subjectClasses.length > 0 &&
    !subjectClasses.every((name) => matchesAllowlist(name, index))
  ) {
    return false;
  }

  return ancestorClasses.every((name) => classMatchesAllowlist(name, index));
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
  const index = getAllowlistIndex(allowlist);
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
      shouldKeepSelector(selectee, index)
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
