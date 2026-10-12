/**
 * Accuracy and payoff check for specializing Carbon components
 * (`src/analyzer/specialize.ts`), the core of `optimizeComponents`.
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
 * Apps that render Carbon through their own wrappers (`./wrapper-cases.ts`)
 * run too, with the wrappers rewritten; `--wrappers` runs only those.
 * `--golden` runs the realistic apps in `golden/` instead (Svelte 5).
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
import { collectAppUsage } from "../src/analyzer/app-usage";
import { readCarbonComponents } from "../src/analyzer/call-sites";
import { specializeComponent } from "../src/analyzer/specialize";
import { parse } from "../src/indexer/parser";
import { resolveCarbonRoot } from "../src/indexer/resolve-carbon-root";
import { goldenApps } from "./golden-apps";
import { buildCases, caseSource } from "./prop-aware-cases";
import { wrapperCases } from "./wrapper-cases";

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
    // Unwrap branches known to run (Svelte 5 only).
    unwrap: { type: "boolean" },
    project: { type: "string" },
    // Only the apps with their own wrapper components.
    wrappers: { type: "boolean" },
    // Only the golden apps in `golden/` (see `golden-apps.ts`).
    golden: { type: "boolean" },
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
const { compile, compileModule } = (await import(
  Bun.resolveSync("svelte/compiler", PROJECT)
)) as { compile: Compile; compileModule?: Compile };
const GENERATE =
  svelteMajor >= 5
    ? { server: "server", client: "client" }
    : { server: "ssr", client: "dom" };
const carbonSrc = path.join(carbonRoot, "src");
const carbon = readCarbonComponents(carbonRoot);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

type EvalCase = ReturnType<typeof buildCases>[number] & {
  /** An app of several files, the first rendered: see `wrapper-cases.ts`. */
  files?: Record<string, string>;
  /** An app's existing files, `file` the one rendered (`golden/`). */
  appFiles?: Array<{ file: string; code: string }>;
};

const cases: EvalCase[] = args.golden
  ? goldenApps(ROOT, args.only).map((app) => ({
      id: app.id,
      components: app.components,
      markup: "",
      file: app.entry,
      appFiles: app.files,
    }))
  : [
      ...(args.wrappers
        ? []
        : buildCases({
            root: ROOT,
            carbon,
            carbonSrc,
            only: args.only,
            apps: args.apps,
            combos: Number(args.combos),
            seed: Number(args.seed),
          })),
      // Apps with their own wrappers, which get rewritten too.
      ...(args.only || args.apps
        ? []
        : wrapperCases({
            count: Math.ceil(Number(args.combos) / 5),
            seed: Number(args.seed),
            runes: svelteMajor >= 5,
          }).map((wrapper) => ({ ...wrapper, markup: "" }))),
    ];

// ---------- bundling ----------

const SVELTE_FILE = /\.svelte$/;
const SVELTE_MODULE = /\.svelte\.[jt]s$/;
const typescript = new Bun.Transpiler({ loader: "ts" });
const CSS_FILE = /\.css$/;
const WHITESPACE = /\s+/;
const SCOPING_CLASS = /^svelte-[a-z0-9]+$/;
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
      // Svelte 5's rune modules (`cart.svelte.ts`), TypeScript stripped
      // first as Vite's Svelte plugin does.
      build.onLoad({ filter: SVELTE_MODULE }, async ({ path: file }) => {
        if (!compileModule) throw new Error(`${file} needs Svelte 5`);
        let source = await Bun.file(file).text();
        if (file.endsWith(".ts")) source = typescript.transformSync(source);
        const js = compileModule(source, {
          filename: file,
          generate: GENERATE[generate],
        }).js.code;
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
      // Scoping classes (`svelte-1x2y3z`) go on the elements a wrapper's
      // own `<style>` could match: one whose `class:` directive no call
      // site turns on loses it with the directive, though no rule applied.
      .replace(/class="([^"]*)"/g, (_, value: string) => {
        const classes = value
          .trim()
          .split(WHITESPACE)
          .filter((name) => !SCOPING_CLASS.test(name));
        return `class="${classes.join(" ")}"`;
      })
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
  /** Of `edits`, those in the app's own components. */
  appEdits?: number;
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
  let appFile: string;
  const files: Array<{ file: string; code: string }> = [];
  if (testCase.appFiles && testCase.file) {
    appFile = testCase.file;
    files.push(...testCase.appFiles);
  } else if (testCase.files) {
    const dir = path.join(OUT, `case-${n}`);
    mkdirSync(dir, { recursive: true });
    for (const [name, code] of Object.entries(testCase.files)) {
      files.push({ file: path.join(dir, name), code });
      writeFileSync(path.join(dir, name), code);
    }
    appFile = files[0].file;
  } else {
    appFile = testCase.file ?? path.join(OUT, `case-${n}.svelte`);
    const code = caseSource(testCase, carbon);
    if (!testCase.file) writeFileSync(appFile, code);
    files.push({ file: appFile, code });
  }

  // The app's own components, closed when every call site is in `files`.
  const appUsage = collectAppUsage(files, carbon);
  // biome-ignore lint/performance/noAwaitInLoops: one app at a time keeps output attributable
  const result = await analyzeFiles({
    projectRoot: PROJECT,
    files,
    components: testCase.components,
    options: {},
    appUsage,
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
  let appEdits = 0;
  let invalid: string | undefined;
  const t = performance.now();
  for (const key of result.analysis.liveComponents) {
    const scope = result.analysis.scopeFor(key);
    if (!scope) continue;
    const specialized = specializeComponent(scope, {
      emptyBlock,
      dropUnused: !args["no-drop"],
      unwrap: args.unwrap,
    });
    edits += specialized.edits;
    try {
      parse(specialized.code);
    } catch (error) {
      invalid = `${key}: ${(error as Error).message}`;
    }
    overrides.set(path.join(carbonSrc, key), specialized.code);
  }
  for (const file of appUsage.closed) {
    const scope = appUsage.scopeFor(file);
    if (!scope) continue;
    const specialized = specializeComponent(scope, {
      emptyBlock,
      dropUnused: !args["no-drop"],
      unwrap: args.unwrap,
    });
    if (specialized.edits === 0) continue;
    edits += specialized.edits;
    appEdits += specialized.edits;
    try {
      parse(specialized.code);
    } catch (error) {
      invalid = `${path.basename(file)}: ${(error as Error).message}`;
    }
    overrides.set(file, specialized.code);
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
    appEdits,
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
