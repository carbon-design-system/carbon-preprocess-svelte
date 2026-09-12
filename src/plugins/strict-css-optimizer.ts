import type { AtRule, Rule } from "postcss";
import { getComponents } from "../component-index-registry";
import { ALWAYS_ON_CLASSES, CONTEXT_ANCESTORS } from "../constants";
import {
  getCarbonClassesFromNormalized,
  splitSelectorList,
  splitSelectorParts,
} from "../indexer/css-selector-utils";
import { isSafelisted, type SafelistEntry } from "./safelist";

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
/**
 * Anything the optimizer could remove: Carbon (`bx-`) selectors, flatpickr
 * selectors and keyframes, and IBM Plex `@font-face` rules. A stylesheet
 * with none of these is returned untouched without a PostCSS round-trip.
 */
const OPTIMIZABLE_CSS = new RegExp(
  `bx-|flatpickr|IBM Plex|${[...FLATPICKR_KEYFRAMES, ...FLATPICKR_CLASS_NAMES].join("|")}`,
);
const EXACT_ONLY_CLASSES = new Set(ALWAYS_ON_CLASSES);
const CONTEXT_ANCESTOR_SET = new Set<string>(CONTEXT_ANCESTORS);

export function hasOptimizableCss(css: string): boolean {
  return OPTIMIZABLE_CSS.test(css);
}

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
  /**
   * Per-class verdicts. Carbon's stylesheet repeats the same ~1.3k class
   * names across ~14k selector positions, so the prefix/parent walk in
   * `matchesAllowlist` only needs to run once per distinct class.
   */
  verdicts: Map<string, boolean>;
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

  const index = {
    exact: allowlist,
    hyphenPrefixes,
    shared,
    verdicts: new Map<string, boolean>(),
  };
  allowlistIndexCache.set(allowlist, index);
  return index;
}

function matchesAllowlist(name: string, index: AllowlistIndex): boolean {
  const cached = index.verdicts.get(name);
  if (cached !== undefined) return cached;

  const verdict = computeAllowlistMatch(name, index);
  index.verdicts.set(name, verdict);
  return verdict;
}

function computeAllowlistMatch(name: string, index: AllowlistIndex): boolean {
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

  // Most pruned rules fail on their subject, so ancestor classes are only
  // extracted once the subject has passed (or has no Carbon class at all).
  if (
    subjectClasses.length > 0 &&
    !subjectClasses.every((name) => matchesAllowlist(name, index))
  ) {
    return false;
  }

  if (parts.ancestors.length === 0) {
    return true;
  }

  const ancestorClasses = parts.ancestors.flatMap((part) =>
    getCarbonClassesFromNormalized(part),
  );

  return ancestorClasses.every((name) => classMatchesAllowlist(name, index));
}

export type PrunedSelector = {
  /** Selectors removed from the list. */
  removed: number;
  /** The trimmed selector list, or `null` when the whole rule goes. */
  selector: string | null;
};

/**
 * Decides what strict mode does to a rule's selector list: `undefined` when
 * nothing changes, otherwise the pruned list (or `null` to drop the rule)
 * with the number of Carbon selectors removed.
 */
export function pruneRuleSelector(
  selector: string,
  options: StrictCssOptimizerOptions,
): PrunedSelector | undefined {
  const { allowlist, preserveFlatpickr, safelist } = options;
  const index = getAllowlistIndex(allowlist);

  // `bx-` is either followed by another hyphen (Carbon) or not (legacy), so
  // one substring check covers both prefixes. A flatpickr match inside any
  // selectee is also a match on the whole list, so one test on the list rules
  // it out for every selectee.
  const hasCarbon = selector.includes("bx-");
  const hasFlatpickr = FLATPICKR_SELECTOR.test(selector);

  if (!(hasCarbon || hasFlatpickr)) {
    return undefined;
  }

  const selectors = splitSelectorList(selector);
  const keptSelectors = selectors.filter((selectee) => {
    if (isSafelisted(selectee, safelist)) {
      return true;
    }

    if (
      hasFlatpickr &&
      !preserveFlatpickr &&
      FLATPICKR_SELECTOR.test(selectee)
    ) {
      return false;
    }

    return !selectee.includes("bx-") || shouldKeepSelector(selectee, index);
  });

  if (keptSelectors.length === 0) {
    return { removed: selectors.length, selector: null };
  }

  if (keptSelectors.length < selectors.length) {
    return {
      removed: selectors.length - keptSelectors.length,
      selector: keptSelectors.join(", "),
    };
  }

  return undefined;
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
  const pruned = pruneRuleSelector(node.selector, options);
  if (!pruned) return 0;

  if (pruned.selector === null) {
    node.remove();
  } else {
    node.selector = pruned.selector;
  }

  return pruned.removed;
}

/** Whether an at-rule is the flatpickr `@keyframes` block to drop. */
export function isFlatpickrKeyframes(
  name: string,
  params: string,
  options: Pick<StrictCssOptimizerOptions, "preserveFlatpickr">,
): boolean {
  return (
    !options.preserveFlatpickr &&
    name === "keyframes" &&
    FLATPICKR_KEYFRAMES.has(params)
  );
}

/**
 * Returns `1` when the flatpickr keyframes node is removed, otherwise `0`.
 */
export function optimizeStrictAtRule(
  node: AtRule,
  options: Pick<StrictCssOptimizerOptions, "preserveFlatpickr">,
): number {
  if (isFlatpickrKeyframes(node.name, node.params, options)) {
    node.remove();
    return 1;
  }

  return 0;
}

const IBM_PLEX_SANS_WEIGHTS = ["300", "400", "600"];

/**
 * Whether an IBM Plex `@font-face` rule is one no Carbon Svelte component
 * uses. Only these faces are kept:
 * - IBM Plex Sans: weights 300/400/600 in normal style
 * - IBM Plex Mono: weight 400 in normal style (for code snippets)
 *
 * Non-IBM Plex faces are never dropped.
 */
export function isUnusedIbmPlexFontFace(
  family: string,
  style: string,
  weight: string,
): boolean {
  if (!family.startsWith("IBM Plex")) {
    return false;
  }

  const is_mono =
    style === "normal" && family === "IBM Plex Mono" && weight === "400";

  const is_sans =
    style === "normal" &&
    family === "IBM Plex Sans" &&
    IBM_PLEX_SANS_WEIGHTS.includes(weight);

  return !(is_sans || is_mono);
}
