import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import postcss from "postcss";
import {
  getCarbonClasses,
  splitSelectorList,
  splitSelectorParts,
} from "./css-selector-utils";

const require = createRequire(import.meta.url);

/** Ancestors we must never auto-propagate (strict bundle pairs stay manual). */
export const LAYOUT_ANCESTOR_DENYLIST = new Set([
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

export function resolveCarbonCssPath(theme = "white"): string {
  const pkg = require.resolve("carbon-components-svelte/package.json");
  return join(dirname(pkg), "css", `${theme}.css`);
}

function walkCarbonRules(
  css: string,
  onRule: (selector: string) => void,
): void {
  const root = postcss.parse(css);
  root.walkRules((rule) => {
    onRule(rule.selector);
  });
}

function buildClassOwners(
  componentClasses: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();

  for (const [component, classes] of componentClasses.entries()) {
    for (const cls of classes) {
      const set = owners.get(cls) ?? new Set<string>();
      set.add(component);
      owners.set(cls, set);
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

function isSlotWrapperGate(
  ancestor: string,
  ancestorOwners: Set<string>,
  slotWrapperComponents: Set<string>,
  slotWrapperClasses: Map<string, string[]>,
): boolean {
  for (const owner of ancestorOwners) {
    if (!slotWrapperComponents.has(owner)) {
      continue;
    }
    const wrappers = slotWrapperClasses.get(owner) ?? [];
    if (wrappers.includes(ancestor)) {
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

function collectAllMarkupClasses(
  componentClasses: Map<string, Set<string>>,
): Set<string> {
  const all = new Set<string>();
  for (const classes of componentClasses.values()) {
    for (const cls of classes) {
      all.add(cls);
    }
  }
  return all;
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

function addClass(
  additions: Map<string, Set<string>>,
  component: string,
  cls: string,
): void {
  const set = additions.get(component) ?? new Set<string>();
  set.add(cls);
  additions.set(component, set);
}

/**
 * Walk Carbon CSS once and infer context ancestors plus CSS-orphan classes.
 */
export function extractCssIndexAdditions(
  options: CssContextOptions,
): CssIndexAdditions {
  const { componentClasses, slotWrapperClasses, subComponents, css } = options;

  const classOwners = buildClassOwners(componentClasses);
  const markupClasses = collectAllMarkupClasses(componentClasses);
  const slotWrapperComponents = new Set(slotWrapperClasses.keys());
  const context = new Map<string, Set<string>>();
  const orphans = new Map<string, Set<string>>();

  walkCarbonRules(css, (selectorList) => {
    for (const branch of splitSelectorList(selectorList)) {
      const parts = splitSelectorParts(branch);

      if (parts) {
        const ancestorClasses = parts.ancestors.flatMap((part) =>
          getCarbonClasses(part),
        );
        const subjectClasses = getCarbonClasses(parts.subject);

        if (ancestorClasses.length > 0 && subjectClasses.length > 0) {
          for (const ancestor of ancestorClasses) {
            if (LAYOUT_ANCESTOR_DENYLIST.has(ancestor)) {
              continue;
            }

            const ancestorOwners =
              classOwners.get(ancestor) ?? new Set<string>();

            for (const subject of subjectClasses) {
              const subjectOwners =
                classOwners.get(subject) ?? new Set<string>();

              if (subjectOwners.size === 0 || ancestorOwners.size === 0) {
                continue;
              }

              if (!setsDisjoint(ancestorOwners, subjectOwners)) {
                continue;
              }

              const gated =
                isSlotWrapperGate(
                  ancestor,
                  ancestorOwners,
                  slotWrapperComponents,
                  slotWrapperClasses,
                ) ||
                isSubComponentGate(
                  ancestorOwners,
                  subjectOwners,
                  subComponents,
                );

              if (!gated) {
                continue;
              }

              for (const component of subjectOwners) {
                addClass(context, component, ancestor);
              }
            }
          }
        }
      }

      const classes = getCarbonClasses(branch);
      const branchOrphans = classes.filter((cls) => !markupClasses.has(cls));

      if (branchOrphans.length === 0) {
        continue;
      }

      const known = classes.filter((cls) => markupClasses.has(cls));

      for (const orphan of branchOrphans) {
        let owners = new Set<string>();

        for (const parent of known) {
          const parentOwners = classOwners.get(parent);
          if (parentOwners) {
            owners = new Set([...owners, ...parentOwners]);
          }
        }

        if (owners.size === 0) {
          continue;
        }

        for (const component of owners) {
          addClass(orphans, component, orphan);
        }
      }
    }
  });

  return { context, orphans };
}

/** @deprecated Use `extractCssIndexAdditions`. */
export function extractCssContextClasses(
  options: CssContextOptions,
): Map<string, Set<string>> {
  return extractCssIndexAdditions(options).context;
}

/** @deprecated Use `extractCssIndexAdditions`. */
export function extractCssOrphanClasses(
  options: CssContextOptions,
): Map<string, Set<string>> {
  return extractCssIndexAdditions(options).orphans;
}
