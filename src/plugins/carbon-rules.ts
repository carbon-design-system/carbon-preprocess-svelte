/**
 * What only Carbon needs pruned on top of svelte-prune's stylesheet pruner:
 * flatpickr's rules (DatePicker's calendar), and the IBM Plex faces no
 * component uses.
 */

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

/** Whether `selector` names one of flatpickr's classes, which DatePicker's calendar applies. */
export function isFlatpickrSelector(selector: string): boolean {
  return MAY_HAVE_FLATPICKR.test(selector) && FLATPICKR_SELECTOR.test(selector);
}

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
export function hasOptimizableCss(css: string): boolean {
  return OPTIMIZABLE_CSS.test(css);
}

/** Whether an at-rule is the flatpickr `@keyframes` block to drop. */
export function isFlatpickrKeyframes(
  name: string,
  params: string,
  options: { preserveFlatpickr: boolean },
): boolean {
  return (
    !options.preserveFlatpickr &&
    name === "keyframes" &&
    FLATPICKR_KEYFRAMES.has(params)
  );
}

const IBM_PLEX_SANS_WEIGHTS = ["300", "400", "600"];
const QUOTED = /^(["'])(.*)\1$/;
const SINGLE_WEIGHT = /^\d+$/;

/**
 * Whether an IBM Plex `@font-face` rule is one no Carbon Svelte component
 * uses. Only the IBM Plex Sans and Mono faces Carbon ships are dropped:
 * Plex Sans 300/400/600 normal stay (italic only if `italic()`, whether
 * `.bx--type-italic` may render), and Plex Mono 400 normal. Any other
 * family, including the app's own Plex Serif or Condensed, and a weight
 * range stay.
 */
export function isUnusedPlexFace(
  family: string,
  style: string,
  weight: string,
  italic: () => boolean,
): boolean {
  const name = family.replace(QUOTED, "$2");
  if (name !== "IBM Plex Sans" && name !== "IBM Plex Mono") return false;
  const faceWeight = weight === "" || weight === "normal" ? "400" : weight;
  if (!SINGLE_WEIGHT.test(faceWeight)) return false;
  const faceStyle = style || "normal";

  if (name === "IBM Plex Mono") {
    return !(faceStyle === "normal" && faceWeight === "400");
  }
  return !(
    IBM_PLEX_SANS_WEIGHTS.includes(faceWeight) &&
    (faceStyle === "normal" || (faceStyle === "italic" && italic()))
  );
}
