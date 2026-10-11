import { type ParsedSelector, parseSelectorList } from "caligula/selector";
import { ALWAYS_ON_CLASSES, CONTEXT_ANCESTORS } from "../constants";
import type { ComponentIndex } from "../indexer/build-index";
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
/** `CONTEXT_ANCESTORS` without the leading `.`, as parsed selectors name them. */
const CONTEXT_ANCESTOR_NAMES = new Set<string>(
  CONTEXT_ANCESTORS.map((cls) => cls.slice(1)),
);

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
   * (`propAware`). A selector that needs one is dropped even
   * when the allowlist matches it.
   */
  isPruned?: (cls: string) => boolean;
};

type Ownership = {
  /** Classes some component renders. */
  owned: Set<string>;
  /** Classes more than one component renders. */
  shared: Set<string>;
};

const ownershipCache = new WeakMap<ComponentIndex, Ownership>();

function getOwnership(components: ComponentIndex): Ownership {
  const cached = ownershipCache.get(components);
  if (cached) return cached;

  const owned = new Set<string>();
  const shared = new Set<string>();

  for (const component of Object.values(components)) {
    for (const cls of component.classes) {
      if (owned.has(cls)) shared.add(cls);
      else owned.add(cls);
    }
  }

  const ownership = { owned, shared };
  ownershipCache.set(components, ownership);
  return ownership;
}

type AllowlistIndex = Ownership & {
  exact: Set<string>;
  hyphenPrefixes: string[];
  /**
   * Per-class verdicts, by name without the `.`: Carbon's stylesheet repeats
   * ~1.3k class names across ~14k selector positions, so the walk runs once
   * per distinct class.
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
    ...getOwnership(components),
    verdicts: new Map(),
  };
  allowlistIndexCache.set(allowlist, index);
  return index;
}

/** `matchesAllowlist` for a class name without the `.`, cached. */
function matchesClass(cls: string, index: AllowlistIndex): boolean {
  const cached = index.verdicts.get(cls);
  if (cached !== undefined) return cached;

  const verdict = matchesAllowlist(`.${cls}`, index);
  index.verdicts.set(cls, verdict);
  return verdict;
}

function matchesAllowlist(name: string, index: AllowlistIndex): boolean {
  if (index.exact.has(name)) return true;

  for (const prefix of index.hyphenPrefixes) {
    if (name.startsWith(prefix)) return true;
  }

  // A BEM child of an allowed class stands in for classes the index
  // doesn't attribute to anyone; one it attributes to some component
  // stays with that component (`.bx--header__menu` with `HeaderNav`, not
  // `Header`).
  if (index.owned.has(name)) return false;

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

/**
 * A selector's class as Carbon names it: `bx--x` as is, legacy `bx-x` as
 * `bx--x`, `null` for any other class.
 */
function carbonClass(cls: string): string | null {
  if (!cls.startsWith("bx-")) return null;
  if (cls.startsWith("bx--")) return cls.length > 4 ? cls : null;
  return cls.length > 3 ? `bx--${cls.slice(3)}` : null;
}

/** Whether every Carbon class in `classes` matches the allowlist. */
function classesMatch(
  classes: readonly string[],
  index: AllowlistIndex,
  ancestor: boolean,
): boolean {
  for (let i = 0; i < classes.length; i++) {
    const cls = carbonClass(classes[i]);
    if (cls === null) continue;
    if (ancestor && CONTEXT_ANCESTOR_NAMES.has(cls)) continue;
    if (!matchesClass(cls, index)) return false;
  }
  return true;
}

/**
 * Whether to keep a selector: every subject class must match the allowlist
 * (exactly, as a hyphen prefix, or as a BEM child of an allowed class), and
 * ancestor classes must too, or be one of `CONTEXT_ANCESTORS`. Classes in
 * `:not()` don't count.
 */
function shouldKeepSelector(
  selector: ParsedSelector,
  index: AllowlistIndex,
): boolean {
  const { compounds } = selector;
  const last = compounds.length - 1;

  // Most pruned rules fail on their subject, so check ancestors second.
  if (!classesMatch(compounds[last].classes, index, false)) return false;
  for (let i = 0; i < last; i++) {
    if (!classesMatch(compounds[i].classes, index, true)) return false;
  }
  return true;
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
 * selectors went. Reads `rule.parsed` only for lists that may change.
 */
export function pruneRuleSelector(
  rule: { selector: string; readonly parsed: readonly ParsedSelector[] },
  options: StrictCssOptimizerOptions,
): PrunedSelector | undefined {
  const { selector } = rule;
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

  const selectors = rule.parsed;
  const kept = selectors.filter((selectee) =>
    keepSelectee(selectee, safelist, dropFlatpickr, index, isPruned),
  );

  if (kept.length === selectors.length) return undefined;

  return {
    removed: selectors.length - kept.length,
    selector:
      kept.length === 0
        ? null
        : kept.map((selectee) => selectee.text).join(", "),
  };
}

/**
 * The list inside a selector that is one `:is(…)` or `:where(…)` and
 * nothing else, as CSS minifiers emit when they merge rules
 * (`:is(.a .b, .c .d)`); `undefined` for any other selector.
 */
export function wrappedSelectorList(text: string): string | undefined {
  const open = text.startsWith(":is(")
    ? 3
    : text.startsWith(":where(")
      ? 6
      : -1;
  if (open === -1 || !text.endsWith(")")) return undefined;
  let depth = 0;
  let quote = "";
  for (let i = open; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(") {
      depth++;
    } else if (char === ")" && --depth === 0) {
      return i === text.length - 1
        ? text.slice(open + 1, text.length - 1)
        : undefined;
    }
  }
  return undefined;
}

function keepSelectee(
  selectee: ParsedSelector,
  safelist: readonly SafelistEntry[],
  dropFlatpickr: boolean,
  index: AllowlistIndex,
  isPruned: ((cls: string) => boolean) | undefined,
): boolean {
  const { text } = selectee;
  if (isSafelisted(text, safelist)) return true;
  // `:is(A, B)` matches what `A, B` does: keep it if any branch can match.
  // Parsed whole, it would require only the classes every branch shares.
  const list = wrappedSelectorList(text);
  if (list !== undefined) {
    return parseSelectorList(list).some((branch) =>
      keepSelectee(branch, safelist, dropFlatpickr, index, isPruned),
    );
  }
  if (isPruned && needsPrunedClass(selectee, isPruned)) return false;
  if (dropFlatpickr && FLATPICKR_SELECTOR.test(text)) return false;
  return !text.includes("bx-") || shouldKeepSelector(selectee, index);
}

/**
 * Whether `selectee` only matches an element with a `.bx--` class `isPruned`
 * rejects. Classes in `:not()` and `:has()` don't count: those don't
 * require the class.
 */
function needsPrunedClass(
  selectee: ParsedSelector,
  isPruned: (cls: string) => boolean,
): boolean {
  for (const { classes } of selectee.compounds) {
    for (const cls of classes) {
      if (cls.startsWith("bx--") && isPruned(`.${cls}`)) return true;
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
