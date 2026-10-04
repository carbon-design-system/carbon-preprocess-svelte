/**
 * Accuracy check for `experimental.propAware`.
 *
 * Generates one tiny app per (Carbon component, prop value): every string
 * literal value a prop's JSDoc `@type` lists, every boolean flipped from its
 * default, plus no props and default-slot content. Then random multi-site
 * apps mixing those. For each app it:
 *
 *   1. prunes Carbon's CSS as today (every bundled component, all props) and
 *      with `propAware` (the app's props), and
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
import { compile } from "svelte/compiler";
import { render } from "svelte/server";
import { analyzeFiles } from "../src/analyzer";
import { readCarbonComponents } from "../src/analyzer/call-sites";
import { loadComponentModel } from "../src/analyzer/component-model";
import {
  splitSelectorList,
  stripNotPseudoClasses,
} from "../src/indexer/css-selector-utils";
import { loadComponentIndex } from "../src/indexer/load-index";
import { resolveCarbonRoot } from "../src/indexer/resolve-carbon-root";
import { optimizeCssWithReport } from "../src/plugins/create-optimized-css";
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
const carbon = readCarbonComponents(carbonRoot);
const css = readFileSync(path.join(carbonRoot, "css/white.css"), "utf8");
const index = await loadComponentIndex(ROOT);
if (!index) throw new Error("could not build the component index");

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

/** What a bundler would include: the components and every `.svelte` they import. */
function bundledClosure(keys: string[]): string[] {
  const seen = new Set<string>();
  const queue = [...keys];
  for (let key = queue.pop(); key; key = queue.pop()) {
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push(...loadComponentModel(carbonSrc, key).componentImports.values());
  }
  return [...seen];
}

const CLASS_TOKEN = /\.bx--[\w-]+/g;
const CLASS_ATTR = /class="([^"]*)"/g;
const PARENTHESIZED = /\([^()]*\)/g;

/** Each selector in `source`, with the Carbon classes it requires. */
function selectors(source: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  filterCss(source, {
    rule({ selector: list }) {
      for (const selector of splitSelectorList(list)) {
        let positive = stripNotPseudoClasses(selector);
        while (PARENTHESIZED.test(positive)) {
          positive = positive.replace(PARENTHESIZED, "");
        }
        result.set(selector, positive.match(CLASS_TOKEN) ?? []);
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
  error?: string;
};

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
    // biome-ignore lint/performance/noAwaitInLoops: one app at a time keeps errors attributable
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

  const keys = testCase.components.flatMap((name) => carbon.get(name) ?? []);
  const bundledNames = bundledClosure(keys).map(
    (key) => path.posix.parse(key).name,
  );

  const result = await analyzeFiles({
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

  const baselineKey = [...bundledNames].sort().join(",");
  let today = baselineCache.get(baselineKey);
  if (today === undefined) {
    const todayCss = optimizeCssWithReport({
      source: css,
      components: index,
      ids: bundledNames,
    }).css;
    today = { css: todayCss, selectors: selectors(todayCss) };
    baselineCache.set(baselineKey, today);
  }
  const propAware = optimizeCssWithReport({
    source: css,
    components: index,
    ids: bundledNames,
    propAware: args.control ? { ...result, isPruned: () => true } : result,
  }).css;

  const kept = selectors(propAware);
  const lost: string[] = [];
  for (const [selector, classes] of today.selectors) {
    if (
      classes.length > 0 &&
      classes.every((cls) => rendered.has(cls)) &&
      !kept.has(selector)
    ) {
      lost.push(selector);
    }
  }
  outcomes.push({
    id: testCase.id,
    status: lost.length > 0 ? "unsound" : "sound",
    todayBytes: Buffer.byteLength(today.css),
    propAwareBytes: Buffer.byteLength(propAware),
    lost: lost.length > 0 ? lost : undefined,
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

  CSS vs today (sound + unsound apps)
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

process.exit(unsound.length > 0 ? 1 : 0);
