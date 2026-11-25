import { filterCss } from "caligula";
import { CARBON } from "../carbon-library";
import { ALWAYS_ON_CLASSES, CONTEXT_ANCESTORS } from "../constants";
import { isSafelisted, type SafelistEntry } from "./safelist";
import {
  isFlatpickrKeyframes,
  isFlatpickrSelector,
  isUnusedPlexFace,
} from "./carbon-rules";

const ALL_STYLESHEETS = ["carbon-components-svelte/css/*.css"];
// A stylesheet Carbon ships, as a module id: its file name is the part a
// package path needs.
const CARBON_STYLESHEET =
  /[\\/]carbon-components-svelte[\\/]css[\\/]([^\\/?]+\.css)(?:\?|$)/;

// The package paths (`carbon-components-svelte/css/white.css`) of the
// Carbon stylesheets among a build's module `ids`, since the pruner only
// needs to read those. Empty when the build bundles none as a module of
// its own (a CSS `@import`, a `<link>`), so it reads them all.
export function bundledStylesheets(ids: Iterable<string>): string[] {
  const paths = new Set<string>();
  for (const id of ids) {
    const name = CARBON_STYLESHEET.exec(id)?.[1];
    if (name) paths.add(`carbon-components-svelte/css/${name}`);
  }
  return [...paths].sort();
}

/**
 * Carbon's stylesheets, for svelte-prune's pruner: which classes
 * they define.
 */
const CARBON_STYLES = {
  ...CARBON,
  styles: {
    stylesheets: ALL_STYLESHEETS,
    // Apps set these on elements no component renders.
    keep: [...ALWAYS_ON_CLASSES, ...CONTEXT_ANCESTORS].map((cls) =>
      cls.slice(1),
    ),
  },
};

const ITALIC_TYPE_CLASS = ".bx--type-italic";
/** A legacy `bx-x` class (not `bx--x`) in a selector. */
const LEGACY_CLASS = /(?:^|[^-\w])\.bx-(?!-)/;
// Always validated, so which inputs pass through unchanged doesn't depend
// on `preserveAllIBMFonts`.
const READ_DECLS = ["font-face"];

export type CarbonStylePrunerInput = {
  analyzer: typeof import("svelte-prune/internal/analysis");
  root: string;
  /** Whether no live component can apply `cls`, under the app's props. */
  isPruned: (cls: string) => boolean;
  /** Whether a Carbon module (`utils/x.js`) can load. */
  loadable: (key: string) => boolean;
  /** Names of the Carbon components that can render. */
  liveComponents: ReadonlySet<string>;
  /** The app's files, whose classes, custom properties and keyframes stay. */
  files: ReadonlyArray<{ code: string }>;
  safelist: readonly SafelistEntry[];
  preserveAllIBMFonts: boolean;
  /**
   * The Carbon stylesheets the build bundles, from `bundledStylesheets`:
   * the pruner reads only these, where all 19 of Carbon 0.114's take most
   * of its setup. Without them, it reads every one. A stylesheet left out
   * is never wrong, only less pruned: a class goes only if a stylesheet
   * it reads defines it.
   */
  stylesheets?: readonly string[] | undefined;
};

/**
 * Prunes Carbon CSS with svelte-prune's `libraryStylePruner`, then what
 * only Carbon needs: IBM Plex faces no component uses, flatpickr's rules
 * without a DatePicker, and legacy `bx-` selectors whose `bx--` class
 * can't render. `undefined` when svelte-prune can't read
 * Carbon's stylesheets.
 */
export function createCarbonStylePruner(
  input: CarbonStylePrunerInput,
): ((css: string) => { css: string; removed: number }) | undefined {
  const prune = input.analyzer.libraryStylePruner({
    spec:
      input.stylesheets && input.stylesheets.length > 0
        ? {
            ...CARBON_STYLES,
            styles: { ...CARBON_STYLES.styles, stylesheets: input.stylesheets },
          }
        : CARBON_STYLES,
    projectRoot: input.root,
    isPruned: input.isPruned,
    loadable: input.loadable,
    files: input.files,
    safelist: input.safelist,
  });
  if (!prune) return undefined;
  const preserveFlatpickr = input.liveComponents.has("DatePicker");
  const italic = () => !input.isPruned(ITALIC_TYPE_CLASS);

  return (source) => {
    const pruned = prune(source);
    let removed = pruned.rules + pruned.declarations;
    const result = filterCss(pruned.css, {
      readDecls: READ_DECLS,
      rule(rule) {
        const hasLegacy = LEGACY_CLASS.test(rule.selector);
        const hasFlatpickr =
          !preserveFlatpickr && isFlatpickrSelector(rule.selector);
        if (!(hasLegacy || hasFlatpickr)) return;
        const kept = rule.parsed.filter((selectee) => {
          if (isSafelisted(selectee.text, input.safelist)) return true;
          if (hasFlatpickr && isFlatpickrSelector(selectee.text)) return false;
          // `bx-x` is the legacy name of `bx--x`.
          return !selectee.compounds.some(({ classes }) =>
            classes.some(
              (cls) =>
                cls.startsWith("bx-") &&
                !cls.startsWith("bx--") &&
                cls.length > 3 &&
                input.isPruned(`.bx--${cls.slice(3)}`),
            ),
          );
        });
        if (kept.length === rule.parsed.length) return;
        removed += rule.parsed.length - kept.length;
        return kept.length === 0
          ? false
          : kept.map((selectee) => selectee.text).join(", ");
      },
      atRule(atRule) {
        if (
          isFlatpickrKeyframes(atRule.name, atRule.params, {
            preserveFlatpickr,
          })
        ) {
          removed++;
          return false;
        }
        if (input.preserveAllIBMFonts || atRule.name !== "font-face") return;
        let family = "";
        let style = "";
        let weight = "";
        atRule.walkDecls((prop, value) => {
          if (prop === "font-family") family = value;
          else if (prop === "font-style") style = value;
          else if (prop === "font-weight") weight = value;
        });
        if (isUnusedPlexFace(family, style, weight, italic)) {
          removed++;
          return false;
        }
      },
    });
    return { css: result.css, removed };
  };
}
