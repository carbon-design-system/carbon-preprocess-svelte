import { join } from "node:path";
import { filterCss } from "caligula";
import {
  findSubjectStart,
  getCarbonClassesFromNormalized,
  splitSelectorList,
  stripNotPseudoClasses,
} from "./css-selector-utils";
import { resolveCarbonRoot } from "./resolve-carbon-root";

/** Ancestors never auto-propagated: these bundle pairs stay manual. */
const LAYOUT_ANCESTOR_DENYLIST = new Set([
  ".bx--modal",
  ".bx--form--fluid",
  ".bx--pagination",
  ".bx--tabs",
  ".bx--data-table",
  ".bx--tooltip",
  ".bx--overflow-menu",
  ".bx--list-box",
  ".bx--combo-box",
  ".bx--accordion",
  ".bx--structured-list",
  ".bx--notification",
  ".bx--inline-notification",
  ".bx--toast-notification",
]);

export function resolveCarbonCssPath(
  carbonRoot: string = resolveCarbonRoot(),
  theme = "white",
): string {
  return join(carbonRoot, "css", `${theme}.css`);
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

function setsDisjoint(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) {
    if (b.has(value)) {
      return false;
    }
  }
  return true;
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

function isSlotWrapperGate(
  ancestor: string,
  ancestorOwners: Set<string>,
  slotWrapperClasses: Map<string, string[]>,
): boolean {
  for (const owner of ancestorOwners) {
    if (slotWrapperClasses.get(owner)?.includes(ancestor)) {
      return true;
    }
  }
  return false;
}

function isSubComponentGate(
  ancestorOwners: Set<string>,
  subjectOwners: Set<string>,
  subComponents: Map<string, string[]>,
): boolean {
  for (const parent of ancestorOwners) {
    const children = subComponents.get(parent) ?? [];
    for (const child of children) {
      if (subjectOwners.has(child)) {
        return true;
      }
    }
  }
  return false;
}

export type CssContextOptions = {
  componentClasses: Map<string, Set<string>>;
  slotWrapperClasses: Map<string, string[]>;
  subComponents: Map<string, string[]>;
  css: string;
};

export type CssIndexAdditions = {
  context: Map<string, Set<string>>;
  orphans: Map<string, Set<string>>;
};

/**
 * Walks Carbon CSS once, inferring context ancestors (classes a component's
 * rules need on an ancestor) and orphans (CSS-only classes of a component).
 */
export function extractCssIndexAdditions(
  options: CssContextOptions,
): CssIndexAdditions {
  const { componentClasses, slotWrapperClasses, subComponents, css } = options;

  const classOwners = buildClassOwners(componentClasses);
  const markupClasses = new Set(classOwners.keys());
  const context = new Map<string, Set<string>>();
  const orphans = new Map<string, Set<string>>();

  forEachRuleSelector(css, (selectorList) => {
    for (const branch of splitSelectorList(selectorList)) {
      const normalized = stripNotPseudoClasses(branch);
      const subjectStart = findSubjectStart(normalized);
      const ancestorClasses = getCarbonClassesFromNormalized(
        normalized.slice(0, subjectStart),
      );
      const subjectClasses = getCarbonClassesFromNormalized(
        normalized.slice(subjectStart),
      );

      if (ancestorClasses.length > 0 && subjectClasses.length > 0) {
        for (const ancestor of ancestorClasses) {
          if (LAYOUT_ANCESTOR_DENYLIST.has(ancestor)) {
            continue;
          }

          const ancestorOwners = classOwners.get(ancestor);
          if (!ancestorOwners || ancestorOwners.size === 0) {
            continue;
          }

          for (const subject of subjectClasses) {
            const subjectOwners = classOwners.get(subject);
            if (!subjectOwners || subjectOwners.size === 0) {
              continue;
            }

            if (!setsDisjoint(ancestorOwners, subjectOwners)) {
              continue;
            }

            const gated =
              isSlotWrapperGate(ancestor, ancestorOwners, slotWrapperClasses) ||
              isSubComponentGate(ancestorOwners, subjectOwners, subComponents);

            if (!gated) {
              continue;
            }

            for (const component of subjectOwners) {
              addToSet(context, component, ancestor);
            }
          }
        }
      }

      const classes = [...new Set([...ancestorClasses, ...subjectClasses])];
      const branchOrphans = classes.filter((cls) => !markupClasses.has(cls));

      if (branchOrphans.length === 0) {
        continue;
      }

      const owners = new Set<string>();
      for (const parent of classes) {
        if (!markupClasses.has(parent)) continue;
        const parentOwners = classOwners.get(parent);
        if (parentOwners) {
          for (const owner of parentOwners) {
            owners.add(owner);
          }
        }
      }

      if (owners.size === 0) {
        continue;
      }

      for (const orphan of branchOrphans) {
        for (const component of owners) {
          addToSet(orphans, component, orphan);
        }
      }
    }
  });

  return { context, orphans };
}
