import { existsSync } from "node:fs";
import { join } from "node:path";
import { filterCss } from "caligula";
import { type ParsedSelector, requiredClasses } from "caligula/selector";
import { resolveCarbonRoot } from "./resolve-carbon-root";

/**
 * Theme stylesheets the index can read, in order of preference: each
 * holds every component's rules. Carbon's 1.0 prereleases ship no
 * `white.css`.
 */
const INDEXED_THEMES = ["white", "g10", "g90", "g100", "all"];

/** `css/<theme>.css`, or by default the first indexed theme Carbon ships. */
export function resolveCarbonCssPath(
  carbonRoot: string = resolveCarbonRoot(),
  theme?: string,
): string {
  const path = (name: string) => join(carbonRoot, "css", `${name}.css`);
  if (theme) return path(theme);
  return (
    INDEXED_THEMES.map(path).find((file) => existsSync(file)) ??
    path(INDEXED_THEMES[0])
  );
}

function addToSet(
  map: Map<string, Set<string>>,
  key: string,
  value: string,
): void {
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

function buildClassOwners(
  componentClasses: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();

  for (const [component, classes] of componentClasses.entries()) {
    for (const cls of classes) {
      addToSet(owners, cls, component);
    }
  }

  return owners;
}

/** Calls `onRule` with each rule's parsed selectors; throws on CSS caligula can't model. */
function forEachRuleSelector(
  css: string,
  onRule: (selectors: readonly ParsedSelector[]) => void,
): void {
  const { skipped } = filterCss(css, {
    rule({ parsed }) {
      onRule(parsed);
    },
  });
  if (skipped) {
    throw new Error(
      "forEachRuleSelector: input is outside the shape caligula models",
    );
  }
}

/**
 * The Carbon classes a selector requires, as `.bx--x` (legacy `.bx-x` read
 * as `.bx--x`, listed after the others).
 */
function carbonClassesOf(selector: ParsedSelector): string[] {
  const classes: string[] = [];
  const legacy: string[] = [];
  for (const cls of requiredClasses(selector, { prefix: "bx-" })) {
    if (cls.startsWith("bx--")) {
      if (cls.length > 4) classes.push(`.${cls}`);
    } else if (cls.length > 3) {
      legacy.push(`.bx--${cls.slice(3)}`);
    }
  }
  for (const cls of legacy) {
    if (!classes.includes(cls)) classes.push(cls);
  }
  return classes;
}

export type CssOrphanOptions = {
  componentClasses: Map<string, Set<string>>;
  css: string;
};

/**
 * Walks Carbon CSS once for orphans: classes only the CSS names (no
 * component's markup does), each credited to the components whose
 * classes share a selector with it.
 */
export function extractCssOrphans(
  options: CssOrphanOptions,
): Map<string, Set<string>> {
  const { componentClasses, css } = options;

  const classOwners = buildClassOwners(componentClasses);
  const markupClasses = new Set(classOwners.keys());
  const orphans = new Map<string, Set<string>>();

  forEachRuleSelector(css, (selectors) => {
    for (const branch of selectors) {
      const classes = carbonClassesOf(branch);
      const branchOrphans = classes.filter((cls) => !markupClasses.has(cls));
      if (branchOrphans.length === 0) continue;

      const owners = new Set<string>();
      for (const cls of classes) {
        for (const owner of classOwners.get(cls) ?? []) owners.add(owner);
      }
      for (const orphan of branchOrphans) {
        for (const component of owners) addToSet(orphans, component, orphan);
      }
    }
  });

  return orphans;
}
