import { ALWAYS_ON_CLASSES, CONTEXT_ANCESTORS } from "../constants";
import type { ComponentIndex } from "../indexer/build-index";
import {
  findSubjectStart,
  HYPHEN,
  isClassTokenChar,
  splitSelectorList,
  stripNotPseudoClasses,
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
 * Cheap necessary condition for `FLATPICKR_SELECTOR`: its class names all
 * contain an uppercase letter except `flatpickr-*` and `cur-month`, while
 * Carbon's own selectors are lowercase. Skips the alternation regex for
 * nearly every rule in a Carbon theme.
 */
const MAY_HAVE_FLATPICKR = /[A-Z]|flatpickr|cur-month/;

/**
 * Anything the optimizer could remove: Carbon (`bx-`) selectors, flatpickr
 * selectors and keyframes, and IBM Plex `@font-face` rules. A stylesheet
 * with none of these is returned untouched without a parse.
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
  /** Index `allowlist` was built from; supplies the classes shared between components. */
  components: ComponentIndex;
  preserveFlatpickr: boolean;
  safelist: readonly SafelistEntry[];
  /**
   * Classes no rendered component can apply under the app's props
   * (`experimental.propAware`). A selector that needs one is dropped even
   * when the allowlist matches it.
   */
  isPruned?: (cls: string) => boolean;
};

const sharedClassesCache = new WeakMap<ComponentIndex, Set<string>>();

/** Classes more than one component renders. */
function getSharedClasses(components: ComponentIndex): Set<string> {
  const cached = sharedClassesCache.get(components);
  if (cached) return cached;

  const seen = new Set<string>();
  const shared = new Set<string>();

  for (const component of Object.values(components)) {
    for (const cls of component.classes) {
      if (seen.has(cls)) shared.add(cls);
      else seen.add(cls);
    }
  }

  sharedClassesCache.set(components, shared);
  return shared;
}

type AllowlistIndex = {
  exact: Set<string>;
  hyphenPrefixes: string[];
  shared: Set<string>;
  /**
   * Per-class verdicts: Carbon's stylesheet repeats ~1.3k class names across
   * ~14k selector positions, so the walk runs once per distinct class.
   */
  verdicts: Map<string, boolean>;
};

const allowlistIndexCache = new WeakMap<Set<string>, AllowlistIndex>();

function getAllowlistIndex(
  allowlist: Set<string>,
  components: ComponentIndex,
): AllowlistIndex {
  const cached = allowlistIndexCache.get(allowlist);
  if (cached) return cached;

  const index: AllowlistIndex = {
    exact: allowlist,
    hyphenPrefixes: [...allowlist].filter(
      (selector) => selector.endsWith("-") && !EXACT_ONLY_CLASSES.has(selector),
    ),
    shared: getSharedClasses(components),
    verdicts: new Map(),
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

const CLASSES_NONE = 0;
const CLASSES_MATCH = 1;
const CLASSES_MISS = 2;

/**
 * Runs the allowlist over every Carbon class token in `normalized[from, to)`
 * (legacy `.bx-x` read as `.bx--x`), stopping at the first miss. Yields the
 * same tokens as `getCarbonClassesFromNormalized` without materializing them.
 */
function scanCarbonClasses(
  normalized: string,
  from: number,
  to: number,
  index: AllowlistIndex,
  ancestor: boolean,
): number {
  let start = normalized.indexOf(".bx-", from);
  if (start === -1 || start >= to) return CLASSES_NONE;

  let result = CLASSES_NONE;

  while (start !== -1 && start < to) {
    const isCarbon = normalized.charCodeAt(start + 4) === HYPHEN;
    const tokenStart = isCarbon ? start + 5 : start + 4;
    let end = tokenStart;
    while (end < to && isClassTokenChar(normalized.charCodeAt(end))) {
      end++;
    }

    if (end > tokenStart) {
      const name = isCarbon
        ? normalized.slice(start, end)
        : `.bx--${normalized.slice(tokenStart, end)}`;
      const matched = ancestor
        ? classMatchesAllowlist(name, index)
        : matchesAllowlist(name, index);
      if (!matched) return CLASSES_MISS;
      result = CLASSES_MATCH;
    }

    start = normalized.indexOf(".bx-", end);
  }

  return result;
}

/**
 * Whether to keep a selector: every subject class must match the allowlist
 * (exactly, as a hyphen prefix, or as a BEM child of an allowed class), and
 * ancestor classes must too, or be one of `CONTEXT_ANCESTORS`.
 */
function shouldKeepSelector(selector: string, index: AllowlistIndex): boolean {
  const normalized = stripNotPseudoClasses(selector);
  const subjectStart = findSubjectStart(normalized);

  // Most pruned rules fail on their subject, so check ancestors second.
  if (
    scanCarbonClasses(
      normalized,
      subjectStart,
      normalized.length,
      index,
      false,
    ) === CLASSES_MISS
  ) {
    return false;
  }

  return (
    subjectStart === 0 ||
    scanCarbonClasses(normalized, 0, subjectStart, index, true) !== CLASSES_MISS
  );
}

export type PrunedSelector = {
  /** Selectors removed from the list. */
  removed: number;
  /** The trimmed selector list, or `null` when the whole rule goes. */
  selector: string | null;
};

/**
 * What pruning does to a rule's selector list: `undefined` when nothing
 * changes, else the pruned list (`null` drops the rule) and how many
 * selectors went.
 */
export function pruneRuleSelector(
  selector: string,
  options: StrictCssOptimizerOptions,
): PrunedSelector | undefined {
  const { allowlist, components, preserveFlatpickr, safelist, isPruned } =
    options;
  const index = getAllowlistIndex(allowlist, components);

  // `bx-` covers both the Carbon (`bx--`) and legacy (`bx-`) prefixes. One
  // flatpickr test on the whole list rules it out for every selectee.
  const hasCarbon = selector.includes("bx-");
  const hasFlatpickr =
    MAY_HAVE_FLATPICKR.test(selector) && FLATPICKR_SELECTOR.test(selector);

  if (!(hasCarbon || hasFlatpickr)) return undefined;

  const dropFlatpickr = hasFlatpickr && !preserveFlatpickr;

  // Single selectee (the common case): no list to split or rebuild.
  if (!selector.includes(",")) {
    return keepSelectee(
      selector.trim(),
      safelist,
      dropFlatpickr,
      index,
      isPruned,
    )
      ? undefined
      : { removed: 1, selector: null };
  }

  const selectors = splitSelectorList(selector);
  const kept = selectors.filter((selectee) =>
    keepSelectee(selectee, safelist, dropFlatpickr, index, isPruned),
  );

  if (kept.length === selectors.length) return undefined;

  return {
    removed: selectors.length - kept.length,
    selector: kept.length === 0 ? null : kept.join(", "),
  };
}

function keepSelectee(
  selectee: string,
  safelist: readonly SafelistEntry[],
  dropFlatpickr: boolean,
  index: AllowlistIndex,
  isPruned: ((cls: string) => boolean) | undefined,
): boolean {
  if (isSafelisted(selectee, safelist)) return true;
  if (isPruned && needsPrunedClass(selectee, isPruned)) return false;
  if (dropFlatpickr && FLATPICKR_SELECTOR.test(selectee)) return false;
  return !selectee.includes("bx-") || shouldKeepSelector(selectee, index);
}

const DOT = 46;
const OPEN_PAREN = 40;
const CLOSE_PAREN = 41;

/**
 * Whether `selectee` only matches an element with a class `isPruned`
 * rejects. Classes inside `:not(…)`, `:is(…)`, `:where(…)`, `:has(…)` are
 * skipped: those don't require the class.
 */
function needsPrunedClass(
  selectee: string,
  isPruned: (cls: string) => boolean,
): boolean {
  let depth = 0;
  for (let i = 0; i < selectee.length; i++) {
    const code = selectee.charCodeAt(i);
    if (code === OPEN_PAREN) depth++;
    else if (code === CLOSE_PAREN) depth = Math.max(0, depth - 1);
    else if (code === DOT && depth === 0 && selectee.startsWith(".bx--", i)) {
      let end = i + 5;
      while (
        end < selectee.length &&
        isClassTokenChar(selectee.charCodeAt(end))
      ) {
        end++;
      }
      if (isPruned(selectee.slice(i, end))) return true;
      i = end - 1;
    }
  }
  return false;
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

const IBM_PLEX_SANS_WEIGHTS = ["300", "400", "600"];

/** Class `<Text italic>` renders: the only Carbon rule that uses italic Plex. */
const ITALIC_TYPE_CLASS = ".bx--type-italic";

/**
 * Whether an IBM Plex `@font-face` rule is one no Carbon Svelte component
 * uses. Kept: Plex Sans 300/400/600 normal (italic only if `.bx--type-italic`
 * is allowlisted) and Plex Mono 400 normal. Other families are never dropped.
 */
export function isUnusedIbmPlexFontFace(
  family: string,
  style: string,
  weight: string,
  options: Pick<StrictCssOptimizerOptions, "allowlist" | "components">,
): boolean {
  if (!family.startsWith("IBM Plex")) return false;

  const isMono =
    style === "normal" && family === "IBM Plex Mono" && weight === "400";

  const isSans =
    family === "IBM Plex Sans" &&
    IBM_PLEX_SANS_WEIGHTS.includes(weight) &&
    (style === "normal" ||
      (style === "italic" &&
        matchesAllowlist(
          ITALIC_TYPE_CLASS,
          getAllowlistIndex(options.allowlist, options.components),
        )));

  return !(isSans || isMono);
}
