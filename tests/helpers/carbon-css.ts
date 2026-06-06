import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { components } from "carbon-preprocess-svelte/component-index";
import { ALWAYS_ON_CLASSES } from "carbon-preprocess-svelte/constants";
import postcss from "postcss";

const require = createRequire(import.meta.url);

const CARBON_CLASS = /\.bx--[A-Za-z0-9_-]+/g;
const LEGACY_CARBON_CLASS = /\.bx-(?!-)[A-Za-z0-9_-]+/g;
const BEM_PREFIXES = ["--", "__"];
const EXACT_ONLY_CLASSES = new Set(ALWAYS_ON_CLASSES);

/**
 * Load Carbon's pre-compiled theme CSS from `carbon-components-svelte`.
 * Resolves through `package.json` because the package `exports` map blocks `css/*`.
 * Any theme works for selector coverage; colors differ but selectors do not.
 */
export function resolveCarbonCss(theme = "white"): string {
  const pkg = require.resolve("carbon-components-svelte/package.json");
  const cssPath = join(dirname(pkg), "css", `${theme}.css`);

  if (!existsSync(cssPath)) {
    throw new Error(
      `Carbon CSS not found at ${cssPath}. Run \`bun install\` so ` +
        "`carbon-components-svelte` is available before running these tests.",
    );
  }

  return readFileSync(cssPath, "utf-8");
}

/**
 * Pretty-print minified CSS for readable diffs (one rule and one declaration per line).
 * Tweaks PostCSS `raws` only; same library as the plugin.
 */
export function prettifyCss(css: string): string {
  const root = postcss.parse(css);

  root.walk((node) => {
    if (node.type === "rule") {
      // Don't touch `node.selector`; `:is(.a, .b)` must stay intact.
      node.raws.before = node.prev() ? "\n" : "";
      node.raws.between = " ";
      node.raws.after = "\n";
    } else if (node.type === "atrule") {
      node.raws.before = node.prev() ? "\n" : "";
      node.raws.between = node.nodes ? " " : "";
      node.raws.afterName = node.params ? " " : "";
      node.raws.after = "\n";
    } else if (node.type === "decl") {
      node.raws.before = "\n  ";
      node.raws.between = ": ";
    } else if (node.type === "comment") {
      node.raws.before = node.prev() ? "\n" : "";
    }
  });

  return `${root.toString().trim()}\n`;
}

/**
 * Pull `.bx--*` tokens from a selector. Normalizes legacy `.bx-` to `.bx--`.
 * Matches `getCarbonClasses` in the source so drift shows up in tests.
 */
export function carbonClassesIn(selector: string): string[] {
  const classes = selector.match(CARBON_CLASS) ?? [];
  const legacy = (selector.match(LEGACY_CARBON_CLASS) ?? []).map((cls) =>
    cls.replace(".bx-", ".bx--"),
  );

  return [...new Set([...classes, ...legacy])];
}

/**
 * Build the allowlist like `buildUsage`: `.bx--body` plus each component's classes.
 * Duplicated here instead of importing private plugin code.
 */
export function buildAllowlist(ids: string[]): Set<string> {
  const allowlist = new Set(ALWAYS_ON_CLASSES);

  for (const id of ids) {
    const entry = components[id as keyof typeof components];
    if (entry) {
      for (const cls of entry.classes) {
        allowlist.add(cls);
      }
    }
  }

  return allowlist;
}

/** Classes owned by more than one component (e.g. `.bx--skeleton`). */
export const sharedClasses: Set<string> = (() => {
  const counts = new Map<string, number>();

  for (const component of Object.values(components)) {
    for (const cls of new Set(component.classes)) {
      counts.set(cls, (counts.get(cls) ?? 0) + 1);
    }
  }

  return new Set(
    [...counts].filter(([, count]) => count > 1).map(([cls]) => cls),
  );
})();

/**
 * True if `name` is allowed: exact match, `-` prefix (`.bx--btn--` matches
 * `.bx--btn--primary`), or BEM child (`--` / `__`). Same rules as
 * `strict-css-optimizer.ts`.
 */
export function matchesAllowlist(
  name: string,
  allowlist: Set<string>,
): boolean {
  if (allowlist.has(name)) return true;

  for (const selector of allowlist) {
    if (EXACT_ONLY_CLASSES.has(selector)) continue;
    if (selector.endsWith("-") && name.startsWith(selector)) return true;
    if (sharedClasses.has(selector)) continue;
    if (
      BEM_PREFIXES.some((prefix) => name.startsWith(`${selector}${prefix}`))
    ) {
      return true;
    }
  }

  return false;
}
