import { existsSync } from "node:fs";
import { join } from "node:path";
import { filterCss } from "caligula";
import {
  getCarbonClassesFromNormalized,
  splitSelectorList,
  stripNotPseudoClasses,
} from "./css-selector-utils";
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

/** Calls `onRule` with each rule's selector; throws on CSS caligula can't model. */
function forEachRuleSelector(
  css: string,
  onRule: (selector: string) => void,
): void {
  const { skipped } = filterCss(css, {
    rule({ selector }) {
      onRule(selector);
    },
  });
  if (skipped) {
    throw new Error(
      "forEachRuleSelector: input is outside the shape caligula models",
    );
  }
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

  forEachRuleSelector(css, (selectorList) => {
    for (const branch of splitSelectorList(selectorList)) {
      const classes = getCarbonClassesFromNormalized(
        stripNotPseudoClasses(branch),
      );
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
