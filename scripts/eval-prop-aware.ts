/**
 * Accuracy check for pruning by the props the app passes.
 *
 * Generates one tiny app per (Carbon component, prop value): every string
 * literal value a prop's JSDoc `@type` lists, every boolean flipped from its
 * default, plus no props and default-slot content. Then random multi-site
 * apps mixing those. For each app it:
 *
 *   1. prunes Carbon's CSS with every component excluded (each one the app
 *      renders keeps every variant: the baseline) and by the app's props,
 *      and
 *   2. SSR-renders the app with Svelte and collects the classes it renders.
 *
 * An app is UNSOUND when a selector in today's CSS whose Carbon classes the
 * app all renders is missing from the prop-aware CSS. (Combinators and
 * `:not(…)` are ignored, so this over-approximates what matches.) Sound
 * apps report how much smaller the CSS got.
 * SSR only shows the first render: classes that appear after interaction
 * (open menus, hover tooltips) aren't checked here.
 *
 *   bun scripts/eval-prop-aware.ts [--only Button,Modal] [--combos 200] [--json out.json]
 *
 * `--apps <glob>` evaluates existing app files instead (barrel imports need
 * `bun --conditions=svelte`):
 *
 *   bun --conditions=svelte scripts/eval-prop-aware.ts --apps "examples/*\/src/App.svelte"
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { plugin } from "bun";
import { filterCss } from "caligula";
import { requiredClasses } from "caligula/selector";
import { analyzeFiles, libraryAt } from "svelte-prune/internal/analysis";

/** The analysis module, as the plugins load it, for the pruner. */
const analyzer = await import("svelte-prune/internal/analysis");
import { compile } from "svelte/compiler";
import { render } from "svelte/server";
import { CARBON, CSS_FAILURE } from "../src/carbon-library";
import { resolveCarbonRoot } from "../src/indexer/resolve-carbon-root";
import {
  collectedEngine,
  optimizeCssWithReport,
} from "../src/plugins/create-optimized-css";
import { buildCases, caseSource } from "./prop-aware-cases";

// Components that schedule DOM work after an SSR render (`tick().then(…)`)
// reject outside the browser; that's not what this script measures.
process.on("unhandledRejection", () => {});

const SVELTE_FILE = /\.svelte$/;

plugin({
  name: "svelte-ssr",
  setup(build) {
    build.onLoad({ filter: SVELTE_FILE }, async ({ path: file }) => {
      const source = await Bun.file(file).text();
      const { js } = compile(source, { filename: file, generate: "server" });
      return { contents: js.code, loader: "js" };
    });
  },
});

const { values: args } = parseArgs({
  options: {
    only: { type: "string" },
    apps: { type: "string", multiple: true },
    combos: { type: "string", default: "150" },
    json: { type: "string" },
    seed: { type: "string", default: "1" },
    // Sanity check of this script: prune every Carbon class. Expect UNSOUND.
    control: { type: "boolean" },
  },
});

const ROOT = path.resolve(import.meta.dir, "..");
const OUT = path.join(ROOT, ".context/eval-prop-aware");
const carbonRoot = resolveCarbonRoot(ROOT);
const carbonSrc = path.join(carbonRoot, "src");
const carbon = libraryAt(CARBON, carbonRoot).components;
const css = readFileSync(path.join(carbonRoot, "css/white.css"), "utf8");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const cases = buildCases({
  root: ROOT,
  carbon,
  carbonSrc,
  only: args.only,
  apps: args.apps,
  combos: Number(args.combos),
  seed: Number(args.seed),
});
const names = new Set(cases.flatMap((c) => c.components));

// ---------- evaluation ----------

const CLASS_ATTR = /class="([^"]*)"/g;

/** Each selector in `source`, with the Carbon classes it requires. */
function selectors(source: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  filterCss(source, {
    rule({ parsed }) {
      for (const selector of parsed) {
        result.set(
          selector.text,
          requiredClasses(selector, { prefix: "bx--" }).map((cls) => `.${cls}`),
        );
      }
    },
  });
  return result;
}

const baselineCache = new Map<
  string,
  { css: string; selectors: Map<string, string[]> }
>();

type Outcome = {
  id: string;
  status: "sound" | "unsound" | "render-error" | "analysis-error";
  todayBytes?: number;
  propAwareBytes?: number;
  lost?: string[];
  /** Rendered selectors removed whose rules only declared custom properties nothing reads. */
  unread?: string[];
  /** Rendered selectors the baseline (every component excluded) removed. */
  defaultLost?: string[];
  error?: string;
};

/** Every selector in the full stylesheet: what the baseline starts from. */
const fullSelectors = selectors(css);

/**
 * The custom properties each selector's rules declare, for selectors whose
 * rules declare nothing else (`.bx--layer-two { --cds-layer: … }`):
 * removing one only matters if something left reads those properties.
 */
function customPropertyRules(source: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const other = new Set<string>();
  let current: readonly string[] = [];
  filterCss(source, {
    rule({ parsed }) {
      current = parsed.map((selector) => selector.text);
      return undefined;
    },
    atRule() {
      current = [];
      return undefined;
    },
    decl({ prop }) {
      for (const selector of current) {
        if (!prop.startsWith("--")) other.add(selector);
        else {
          const props = result.get(selector) ?? new Set<string>();
          props.add(prop);
          result.set(selector, props);
        }
      }
      return undefined;
    },
  });
  for (const selector of other) result.delete(selector);
  return result;
}

const customOnly = customPropertyRules(css);

/** Whether `source` (pruned CSS, or the app's code) reads any of `props`. */
function readsAny(source: string, props: ReadonlySet<string>): boolean {
  for (const prop of props) if (source.includes(prop)) return true;
  return false;
}

const outcomes: Outcome[] = [];
let n = 0;
const started = performance.now();

for (const testCase of cases) {
  n++;
  const file = testCase.file ?? path.join(OUT, `case-${n}.svelte`);
  const code = caseSource(testCase, carbon);
  if (!testCase.file) writeFileSync(file, code);

  let rendered: Set<string>;
  try {
    const App = (await import(file)).default;
    const { body } = render(App, { props: {} });
    rendered = new Set();
    for (const match of body.matchAll(CLASS_ATTR)) {
      for (const cls of match[1].split(/\s+/)) {
        if (cls.startsWith("bx--")) rendered.add(`.${cls}`);
      }
    }
  } catch (error) {
    outcomes.push({
      id: testCase.id,
      status: "render-error",
      error: String(error).slice(0, 200),
    });
    continue;
  }

  const result = await analyzeFiles({
    library: CARBON,
    failure: CSS_FAILURE,
    projectRoot: ROOT,
    files: [{ file, code }],
    components: testCase.components,
    options: {},
  });
  if ("warning" in result) {
    outcomes.push({
      id: testCase.id,
      status: "analysis-error",
      error: result.warning,
    });
    continue;
  }

  // Per case: the baseline reads the app's code too.
  const baselineKey = `${n}`;
  let today = baselineCache.get(baselineKey);
  if (today === undefined) {
    // The baseline: every component excluded, rendered with any props, so
    // only what nothing renders goes.
    const open = await analyzeFiles({
      library: CARBON,
      failure: CSS_FAILURE,
      projectRoot: ROOT,
      files: [{ file, code }],
      components: testCase.components,
      options: { exclude: [...carbon.keys()] },
    });
    if ("warning" in open) throw new Error(open.warning);
    const todayCss = optimizeCssWithReport({
      source: css,
      analysis: open,
      engine: collectedEngine(open, analyzer, ROOT, [{ code }]),
    }).css;
    today = { css: todayCss, selectors: selectors(todayCss) };
    baselineCache.set(baselineKey, today);
  }
  const propAware = optimizeCssWithReport({
    source: css,
    analysis: args.control ? { ...result, isPruned: () => true } : result,
    // svelte-prune's pruner, as the plugins run it.
    engine: collectedEngine(result, analyzer, ROOT, [{ code }]),
  }).css;

  // The baseline must keep every rule the app's rendered classes match.
  const defaultLost: string[] = [];
  for (const [selector, classes] of fullSelectors) {
    if (
      classes.length > 0 &&
      classes.every((cls) => rendered.has(cls)) &&
      !today.selectors.has(selector)
    ) {
      const props = customOnly.get(selector);
      if (props && !readsAny(today.css, props) && !readsAny(code, props)) {
        continue;
      }
      defaultLost.push(selector);
    }
  }

  const kept = selectors(propAware);
  const lost: string[] = [];
  /** Lost, but declared only custom properties nothing left reads. */
  const unread: string[] = [];
  for (const [selector, classes] of today.selectors) {
    if (
      classes.length > 0 &&
      classes.every((cls) => rendered.has(cls)) &&
      !kept.has(selector)
    ) {
      const props = customOnly.get(selector);
      if (props && !readsAny(propAware, props) && !readsAny(code, props)) {
        unread.push(selector);
      } else {
        lost.push(selector);
      }
    }
  }
  outcomes.push({
    id: testCase.id,
    status: lost.length > 0 ? "unsound" : "sound",
    todayBytes: Buffer.byteLength(today.css),
    propAwareBytes: Buffer.byteLength(propAware),
    lost: lost.length > 0 ? lost : undefined,
    unread: unread.length > 0 ? unread : undefined,
    defaultLost: defaultLost.length > 0 ? defaultLost : undefined,
  });
  if (n % 100 === 0) {
    console.log(
      `  ${n}/${cases.length} (${((performance.now() - started) / 1000).toFixed(0)}s)`,
    );
  }
}

// ---------- summary ----------

const count = (status: Outcome["status"]) =>
  outcomes.filter((o) => o.status === status).length;
const evaluated = outcomes.filter((o) => o.todayBytes !== undefined);
const savings = evaluated
  .map((o) => 1 - (o.propAwareBytes ?? 0) / (o.todayBytes ?? 1))
  .sort((a, b) => a - b);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const quantile = (q: number) =>
  savings[Math.floor(q * (savings.length - 1))] ?? 0;
const sum = (key: "todayBytes" | "propAwareBytes") =>
  evaluated.reduce((total, o) => total + (o[key] ?? 0), 0);

console.log(`
prop-aware accuracy (${names.size} components, ${cases.length} apps, ${((performance.now() - started) / 1000).toFixed(0)}s)
  sound           ${count("sound")}
  UNSOUND         ${count("unsound")}
  render error    ${count("render-error")}  (app didn't SSR; not evaluated)
  analysis error  ${count("analysis-error")}
  the baseline lost a rendered selector in ${outcomes.filter((o) => o.defaultLost).length} apps
  dropped only custom properties nothing reads in ${outcomes.filter((o) => o.unread).length} apps (sound)

  CSS vs every component excluded (sound + unsound apps)
    median saving   ${pct(quantile(0.5))}   p10 ${pct(quantile(0.1))}   p90 ${pct(quantile(0.9))}
    total           ${(sum("todayBytes") / 1024).toFixed(0)} KB -> ${(sum("propAwareBytes") / 1024).toFixed(0)} KB (${pct(1 - sum("propAwareBytes") / sum("todayBytes"))})`);

const unsound = outcomes.filter((o) => o.status === "unsound");
if (unsound.length > 0) {
  console.log(
    "\nUNSOUND apps (selectors matching rendered classes that were pruned):",
  );
  for (const o of unsound.slice(0, 50))
    console.log(`  ${o.id}\n    ${o.lost?.join(" ")}`);
}

const defaultUnsound = outcomes.filter((o) => o.defaultLost);
if (defaultUnsound.length > 0) {
  console.log("\nThe baseline removed selectors matching rendered classes:");
  for (const o of defaultUnsound.slice(0, 50))
    console.log(`  ${o.id}\n    ${o.defaultLost?.join(" ")}`);
}

const renderErrors = outcomes.filter((o) => o.status === "render-error");
if (renderErrors.length > 0) {
  const byComponent = new Map<string, number>();
  for (const o of renderErrors) {
    const name = o.id.split("/")[0];
    byComponent.set(name, (byComponent.get(name) ?? 0) + 1);
  }
  console.log(
    `\nRender errors by component: ${[...byComponent].map(([k, v]) => `${k} (${v})`).join(", ")}`,
  );
}

if (args.json) {
  writeFileSync(args.json, JSON.stringify(outcomes, null, 2));
  console.log(`\nWrote ${args.json}`);
}

process.exit(unsound.length > 0 || defaultUnsound.length > 0 ? 1 : 0);
