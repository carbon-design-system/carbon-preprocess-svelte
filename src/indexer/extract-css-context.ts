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
  const prefixes = [...markupClasses].filter((cls) => cls.endsWith("-"));
  const orphans = new Map<string, Set<string>>();

  /**
   * The components that render `orphan`'s family: its block class
   * (`.bx--table-toolbar` for `.bx--table-toolbar--sm`), or a prefix of it
   * (`.bx--table-toolbar--`, from `bx--table-toolbar--${size}`).
   */
  const familyCache = new Map<string, Set<string>>();
  const familyOwners = (orphan: string): Set<string> => {
    let owners = familyCache.get(orphan);
    if (owners) return owners;
    owners = new Set(classOwners.get(blockOf(orphan)) ?? []);
    for (const prefix of prefixes) {
      if (!orphan.startsWith(prefix)) continue;
      for (const owner of classOwners.get(prefix) ?? []) owners.add(owner);
    }
    familyCache.set(orphan, owners);
    return owners;
  };

  forEachRuleSelector(css, (selectors) => {
    for (const branch of selectors) {
      const classes = carbonClassesOf(branch);
      const branchOrphans = classes.filter((cls) => !markupClasses.has(cls));
      if (branchOrphans.length === 0) continue;

      // Without a family, the components whose classes share the selector.
      const owners = new Set<string>();
      for (const cls of classes) {
        for (const owner of classOwners.get(cls) ?? []) owners.add(owner);
      }
      for (const orphan of branchOrphans) {
        const family = familyOwners(orphan);
        for (const component of family.size > 0 ? family : owners) {
          addToSet(orphans, component, orphan);
        }
      }
    }
  });

  return orphans;
}

const BEM_SEPARATOR = /__|--/;

/** `.bx--table-toolbar--sm` -> `.bx--table-toolbar`; `.bx--btn__icon` -> `.bx--btn`. */
function blockOf(cls: string): string {
  const name = cls.slice(".bx--".length);
  const end = name.search(BEM_SEPARATOR);
  return end === -1 ? cls : `.bx--${name.slice(0, end)}`;
}
