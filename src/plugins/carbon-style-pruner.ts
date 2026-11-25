import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { filterCss } from "caligula";
import { CARBON } from "../carbon-library";
import { resolveCarbonRoot } from "../indexer/resolve-carbon-root";
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

// A Carbon stylesheet as an app's code names it: a JS or Svelte
// `import`, a CSS `@import` or a `<link>`, so a caller without a module
// graph can still read only the ones it uses.
const STYLESHEET_PATH = /carbon-components-svelte\/css\/([\w.-]+\.css)\b/g;

// Adds the package paths of the Carbon stylesheets `code` names
// (`carbon-components-svelte/css/white.css`) to `into`, since a caller
// without a module graph learns from them which ones the pruner reads.
export function collectCarbonStylesheets(
  code: string,
  into: Set<string>,
): void {
  if (!code.includes("carbon-components-svelte/css/")) return;
  for (const [, name] of code.matchAll(STYLESHEET_PATH)) {
    into.add(`carbon-components-svelte/css/${name}`);
  }
}

type StylePruner = NonNullable<
  ReturnType<CarbonStylePrunerInput["analyzer"]["libraryStylePruner"]>
>;

function stylePruner(
  input: CarbonStylePrunerInput,
  stylesheets: readonly string[],
): StylePruner | undefined {
  return input.analyzer.libraryStylePruner({
    spec:
      stylesheets.length > 0
        ? {
            ...CARBON_STYLES,
            styles: { ...CARBON_STYLES.styles, stylesheets },
          }
        : CARBON_STYLES,
    projectRoot: input.root,
    isPruned: input.isPruned,
    loadable: input.loadable,
    files: input.files,
    safelist: input.safelist,
  });
}

// What can tell Carbon's rules from an app's: its `bx--` classes, escapes
// kept (`.bx--lg\:col-span-4`), and its `--cds-` and `--ccs-` properties
// as declared. Its `@keyframes` names have no prefix, but only arrive
// with rules that have these.
const CARBON_CLASS = /\.(bx--(?:[\w-]|\\.)+)/g;
const CARBON_PROPERTY = /(--c[cd]s-[\w-]+)\s*:/g;

type DefinedNames = { classes: Set<string>; properties: Set<string> };

// Keyed by file and modified time, since a build reads the same
// stylesheet for every CSS file, and a watch build for every rebuild.
const definedCache = new Map<
  string,
  { mtimeMs: number; names: DefinedNames }
>();

function addNames(css: string, into: DefinedNames): void {
  for (const [, cls] of css.matchAll(CARBON_CLASS)) into.classes.add(cls);
  for (const [, prop] of css.matchAll(CARBON_PROPERTY))
    into.properties.add(prop);
}

// The Carbon classes and properties `stylesheets` define, read from the
// Carbon installed at `root`; `undefined` if one can't be read, so the
// caller can't trust a narrow pruner.
function definedNames(
  stylesheets: readonly string[],
  root: string,
): DefinedNames | undefined {
  let carbonRoot: string;
  try {
    carbonRoot = resolveCarbonRoot(root);
  } catch {
    return undefined;
  }
  const names: DefinedNames = { classes: new Set(), properties: new Set() };
  for (const stylesheet of stylesheets) {
    const file = path.join(
      carbonRoot,
      stylesheet.slice("carbon-components-svelte/".length),
    );
    let cached = definedCache.get(file);
    try {
      const { mtimeMs } = statSync(file);
      if (cached?.mtimeMs !== mtimeMs) {
        const own: DefinedNames = { classes: new Set(), properties: new Set() };
        addNames(readFileSync(file, "utf8"), own);
        cached = { mtimeMs, names: own };
        definedCache.set(file, cached);
      }
    } catch {
      return undefined;
    }
    for (const cls of cached.names.classes) names.classes.add(cls);
    for (const prop of cached.names.properties) names.properties.add(prop);
  }
  return names;
}

// Whether every Carbon class and property `css` has is one `names`
// holds; the `includes` checks skip the scan for CSS with no Carbon in it.
function covers(names: DefinedNames, css: string): boolean {
  if (css.includes("bx--")) {
    for (const [, cls] of css.matchAll(CARBON_CLASS)) {
      if (!names.classes.has(cls)) return false;
    }
  }
  if (css.includes("--c")) {
    for (const [, prop] of css.matchAll(CARBON_PROPERTY)) {
      if (!names.properties.has(prop)) return false;
    }
  }
  return true;
}

// The `stylesheets` the Carbon installed at `root` ships, since the
// pruner throws for one that matches no file: a name from another Carbon
// install, or one a comment mentions, would fail the build. With none
// left, the pruner reads every one, as without them.
function installedStylesheets(
  stylesheets: readonly string[] | undefined,
  root: string,
): readonly string[] {
  if (!stylesheets || stylesheets.length === 0) return [];
  let carbonRoot: string;
  try {
    carbonRoot = resolveCarbonRoot(root);
  } catch {
    return [];
  }
  const prefix = "carbon-components-svelte/";
  return stylesheets.filter(
    (stylesheet) =>
      stylesheet.startsWith(prefix) &&
      existsSync(path.join(carbonRoot, stylesheet.slice(prefix.length))),
  );
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
  const stylesheets = installedStylesheets(input.stylesheets, input.root);
  const narrow =
    stylesheets.length > 0 ? stylePruner(input, stylesheets) : undefined;
  let all: StylePruner | undefined | null = null;
  const pruneAll = () => {
    all ??= stylePruner(input, []) ?? undefined;
    return all;
  };
  const first = narrow ?? pruneAll();
  if (!first) return undefined;
  const coverage = narrow && definedNames(stylesheets, input.root);
  // The narrow pruner only knows what the stylesheets it read define, so
  // CSS with a Carbon class or property they don't (one a CSS `@import`
  // or a Sass build brought in) gets every stylesheet's, as without them.
  const pruneFor = (css: string): StylePruner =>
    !narrow || (coverage && covers(coverage, css))
      ? first
      : (pruneAll() ?? first);
  const preserveFlatpickr = input.liveComponents.has("DatePicker");
  const italic = () => !input.isPruned(ITALIC_TYPE_CLASS);

  return (source) => {
    const pruned = pruneFor(source)(source);
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
