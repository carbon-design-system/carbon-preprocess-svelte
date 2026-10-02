/**
 * Accuracy and payoff check for specializing Carbon components
 * (`src/analyzer/specialize.ts`), the core of a future `optimizeComponents`.
 *
 * For each app in the prop-aware corpus (see `./prop-aware-cases.ts`):
 *
 *   1. analyzes it and rewrites every Carbon component it renders for the
 *      values its call sites pass, then re-parses each rewritten file;
 *   2. SSR-renders it with the original and the rewritten Carbon sources and
 *      compares the HTML exactly, whitespace included. Only hydration
 *      comments are removed, whitespace inside `class="…"` is collapsed
 *      (Svelte 3/4 leave a space per falsy `class:` directive), and
 *      `Math.random` is seeded so generated ids match;
 *   3. bundles it for the browser, minified, both ways, and compares sizes.
 *
 * An app FAILS when the HTML differs, a rewritten file doesn't parse or
 * compile, or only the rewritten app throws.
 *
 *   bun scripts/eval-specialize.ts [--only Button] [--combos 200] [--json out.json]
 *
 * `--project <dir>` runs against another install: its `svelte` (3, 4 or 5)
 * compiles and renders, and its `carbon-components-svelte` is analyzed. A
 * directory with just a package.json naming both, after `bun install`, is
 * enough.
 *   bun --conditions=svelte scripts/eval-specialize.ts --apps "examples/*\/src/App.svelte"
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { BunPlugin } from "bun";
import { analyzeFiles } from "../src/analyzer";
import { readCarbonComponents } from "../src/analyzer/call-sites";
import { specializeComponent } from "../src/analyzer/specialize";
import { parse } from "../src/indexer/parser";
import { resolveCarbonRoot } from "../src/indexer/resolve-carbon-root";
import { buildCases, caseSource } from "./prop-aware-cases";

process.on("unhandledRejection", () => {});

const { values: args } = parseArgs({
  options: {
    only: { type: "string" },
    apps: { type: "string", multiple: true },
    combos: { type: "string", default: "150" },
    json: { type: "string" },
    seed: { type: "string", default: "1" },
    "empty-block": { type: "string" },
    "skip-size": { type: "boolean" },
    "no-drop": { type: "boolean" },
    "no-unwrap": { type: "boolean" },
    project: { type: "string" },
  },
});

const ROOT = path.resolve(import.meta.dir, "..");
const PROJECT = path.resolve(args.project ?? ROOT);
// Inside the project, so apps and entries resolve its `svelte` and Carbon.
const OUT = path.join(PROJECT, ".eval-specialize");
const carbonRoot = resolveCarbonRoot(PROJECT);

const svelteVersion: string = JSON.parse(
  readFileSync(Bun.resolveSync("svelte/package.json", PROJECT), "utf8"),
).version;
const svelteMajor = Number(svelteVersion.split(".")[0]);
type Compile = (
  source: string,
  options: Record<string, unknown>,
) => { js: { code: string } };
const { compile } = (await import(
  Bun.resolveSync("svelte/compiler", PROJECT)
)) as { compile: Compile };
const GENERATE =
  svelteMajor >= 5
    ? { server: "server", client: "client" }
    : { server: "ssr", client: "dom" };
const carbonSrc = path.join(carbonRoot, "src");
const carbon = readCarbonComponents(carbonRoot);

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

// ---------- bundling ----------

const SVELTE_FILE = /\.svelte$/;
const CSS_FILE = /\.css$/;
const WHITESPACE = /\s+/;
const compiled = new Map<string, string>();

function sveltePlugin(
  overrides: Map<string, string>,
  generate: "client" | "server",
): BunPlugin {
  return {
    name: `svelte-${generate}`,
    setup(build) {
      // Stylesheets an app imports don't affect its markup or JS.
      build.onLoad({ filter: CSS_FILE }, () => ({
        contents: "",
        loader: "js",
      }));
      build.onLoad({ filter: SVELTE_FILE }, async ({ path: file }) => {
        const source = overrides.get(file) ?? (await Bun.file(file).text());
        const cacheKey = `${generate}\0${file}\0${Bun.hash(source)}`;
        let js = compiled.get(cacheKey);
        if (js === undefined) {
          js = compile(source, {
            filename: file,
            generate: GENERATE[generate],
          }).js.code;
          compiled.set(cacheKey, js);
        }
        return { contents: js, loader: "js" };
      });
    },
  };
}

let builds = 0;

/** SSR HTML of `appFile`, without hydration comments. */
async function ssr(appFile: string, overrides: Map<string, string>) {
  const dir = path.join(OUT, `ssr-${builds++}`);
  const entry = path.join(dir, "entry.ts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    entry,
    [
      // Carbon generates ids with Math.random; seed it so both renders match.
      "let seed = 1;",
      "Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;",
      `import App from ${JSON.stringify(appFile)};`,
      ...(svelteMajor >= 5
        ? [
            'import { render } from "svelte/server";',
            "export const html = render(App).body;",
          ]
        : ["export const html = App.render({}).html;"]),
    ].join("\n"),
  );
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: dir,
    // Not `.js`: Bun would resolve `entry.js` to the `entry.ts` beside it.
    naming: "[name].mjs",
    target: "bun",
    conditions: ["svelte"],
    plugins: [sveltePlugin(overrides, "server")],
  });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
  const entryOutput = result.outputs.find((o) => o.path.endsWith(".mjs"));
  if (!entryOutput) throw new Error("no entry output");
  const { html } = (await import(entryOutput.path)) as { html: string };
  return (
    html
      .replace(/<!--[^>]*-->/g, "")
      // Svelte 3/4 leave a space per falsy `class:` directive in the
      // attribute; the class list is the same with or without them.
      .replace(
        /class="([^"]*)"/g,
        (_, value: string) =>
          `class="${value.trim().split(WHITESPACE).join(" ")}"`,
      )
  );
}

/** Minified browser bundle size of `appFile`, raw and gzipped. */
async function clientSize(appFile: string, overrides: Map<string, string>) {
  const result = await Bun.build({
    entrypoints: [appFile],
    minify: true,
    target: "browser",
    conditions: ["svelte"],
    plugins: [sveltePlugin(overrides, "client")],
  });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
  const entryOutput = result.outputs.find((o) => o.kind === "entry-point");
  const code = (await entryOutput?.text()) ?? "";
  return { bytes: code.length, gzip: Bun.gzipSync(code).length };
}

// ---------- evaluation ----------

type Outcome = {
  id: string;
  status:
    | "identical"
    | "DIFFERENT"
    | "INVALID-OUTPUT"
    | "SPECIALIZED-THROWS"
    | "render-error"
    | "analysis-error";
  edits?: number;
  specializeMs?: number;
  before?: { bytes: number; gzip: number };
  after?: { bytes: number; gzip: number };
  detail?: string;
};

function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 80);
  return `original:    …${JSON.stringify(a.slice(from, i + 80))}\n      specialized: …${JSON.stringify(b.slice(from, i + 80))}`;
}

const outcomes: Outcome[] = [];
const started = performance.now();
const emptyBlock = args["empty-block"];

for (const [n, testCase] of cases.entries()) {
  const appFile = testCase.file ?? path.join(OUT, `case-${n}.svelte`);
  const code = caseSource(testCase, carbon);
  if (!testCase.file) writeFileSync(appFile, code);

  // biome-ignore lint/performance/noAwaitInLoops: one app at a time keeps output attributable
  const result = await analyzeFiles({
    projectRoot: PROJECT,
    files: [{ file: appFile, code }],
    components: testCase.components,
    options: {},
  });
  if ("warning" in result) {
    outcomes.push({
      id: testCase.id,
      status: "analysis-error",
      detail: result.warning,
    });
    continue;
  }

  const overrides = new Map<string, string>();
  let edits = 0;
  let invalid: string | undefined;
  const t = performance.now();
  for (const key of result.analysis.liveComponents) {
    const scope = result.analysis.scopeFor(key);
    if (!scope) continue;
    const specialized = specializeComponent(scope, {
      emptyBlock,
      dropUnused: !args["no-drop"],
      unwrap: !args["no-unwrap"],
    });
    edits += specialized.edits;
    try {
      parse(specialized.code);
    } catch (error) {
      invalid = `${key}: ${(error as Error).message}`;
    }
    overrides.set(path.join(carbonSrc, key), specialized.code);
  }
  const specializeMs = performance.now() - t;
  if (invalid) {
    outcomes.push({
      id: testCase.id,
      status: "INVALID-OUTPUT",
      edits,
      detail: invalid,
    });
    continue;
  }

  let original: string;
  try {
    original = await ssr(appFile, new Map());
  } catch (error) {
    const errors = (error as AggregateError).errors?.map(String).join(" ");
    outcomes.push({
      id: testCase.id,
      status: "render-error",
      detail: (errors || String(error)).slice(0, 300),
    });
    continue;
  }

  let specialized: string;
  try {
    specialized = await ssr(appFile, overrides);
  } catch (error) {
    outcomes.push({
      id: testCase.id,
      status: "SPECIALIZED-THROWS",
      edits,
      detail: String(error).slice(0, 300),
    });
    continue;
  }

  const outcome: Outcome = {
    id: testCase.id,
    status: original === specialized ? "identical" : "DIFFERENT",
    edits,
    specializeMs,
    detail:
      original === specialized
        ? undefined
        : firstDifference(original, specialized),
  };
  if (!args["skip-size"]) {
    outcome.before = await clientSize(appFile, new Map());
    outcome.after = await clientSize(appFile, overrides);
  }
  outcomes.push(outcome);
  if ((n + 1) % 100 === 0) {
    console.log(
      `  ${n + 1}/${cases.length} (${((performance.now() - started) / 1000).toFixed(0)}s)`,
    );
  }
}

// ---------- summary ----------

const runtime = await clientSize(
  (() => {
    const file = path.join(OUT, "empty.svelte");
    writeFileSync(file, "<script>export let x = 1;</script>\n<p>{x}</p>\n");
    return file;
  })(),
  new Map(),
);

const count = (status: Outcome["status"]) =>
  outcomes.filter((o) => o.status === status).length;
const sized = outcomes.filter((o) => o.before && o.after);
const ratios = (pick: (o: Outcome) => [number, number]) =>
  sized
    .map((o) => {
      const [before, after] = pick(o);
      return before > 0 ? 1 - after / before : 0;
    })
    .sort((a, b) => a - b);
const quantile = (values: number[], q: number) =>
  values[Math.floor(q * (values.length - 1))] ?? 0;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const minified = ratios((o) => [o.before?.bytes ?? 0, o.after?.bytes ?? 0]);
const gzipped = ratios((o) => [o.before?.gzip ?? 0, o.after?.gzip ?? 0]);
// Carbon's own code: the bundle minus a Svelte-only app's bundle.
const carbonOnly = ratios((o) => [
  (o.before?.bytes ?? 0) - runtime.bytes,
  (o.after?.bytes ?? 0) - runtime.bytes,
]);
const timings = outcomes
  .flatMap((o) => (o.specializeMs === undefined ? [] : [o.specializeMs]))
  .sort((a, b) => a - b);

console.log(`
specialize accuracy: svelte ${svelteVersion}, carbon-components-svelte ${JSON.parse(readFileSync(path.join(carbonRoot, "package.json"), "utf8")).version} (${cases.length} apps, ${((performance.now() - started) / 1000).toFixed(0)}s)
  identical SSR HTML    ${count("identical")}
  DIFFERENT             ${count("DIFFERENT")}
  INVALID-OUTPUT        ${count("INVALID-OUTPUT")}
  SPECIALIZED-THROWS    ${count("SPECIALIZED-THROWS")}
  render error          ${count("render-error")}  (original doesn't SSR; not evaluated)
  analysis error        ${count("analysis-error")}

  minified JS saving    median ${pct(quantile(minified, 0.5))}   p10 ${pct(quantile(minified, 0.1))}   p90 ${pct(quantile(minified, 0.9))}
  gzipped JS saving     median ${pct(quantile(gzipped, 0.5))}   p10 ${pct(quantile(gzipped, 0.1))}   p90 ${pct(quantile(gzipped, 0.9))}
  Carbon code saving    median ${pct(quantile(carbonOnly, 0.5))}   p10 ${pct(quantile(carbonOnly, 0.1))}   p90 ${pct(quantile(carbonOnly, 0.9))}  (bundle minus ${(runtime.bytes / 1024).toFixed(1)} KB Svelte-only app)
  specialize time/app   median ${quantile(timings, 0.5).toFixed(1)} ms   p90 ${quantile(timings, 0.9).toFixed(1)} ms   max ${(timings.at(-1) ?? 0).toFixed(1)} ms`);

const failures = outcomes.filter((o) => o.status === o.status.toUpperCase());
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const o of failures.slice(0, 40)) {
    console.log(`  [${o.status}] ${o.id}\n      ${o.detail}`);
  }
}

if (args.json) {
  writeFileSync(args.json, JSON.stringify(outcomes, null, 2));
  console.log(`\nWrote ${args.json}`);
}

process.exit(failures.length > 0 ? 1 : 0);
