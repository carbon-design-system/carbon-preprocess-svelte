/**
 * Compare the `markdown` preprocessor with carbon-components-svelte's mdsvex
 * docs pipeline on the same `.svx` pages: preprocess time (cold and warm,
 * each run in a fresh process), whether every page still compiles, and
 * whether the Markdown renders to the same text and heading ids.
 *
 *   CCS_DIR=../carbon-components-svelte bun scripts/compare-markdown-mdsvex.ts
 *     [--pages Button,DataTable,TableOfContents] [--runs 3] [--mode production|development]
 *     [--check]   compile every page with both pipelines and diff the Markdown
 *
 * Nothing is written to the CCS checkout.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createCcsMarkdown } from "./markdown-ccs.config";

type Pipeline = "mdsvex" | "markdown";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const ccsDir = path.resolve(
  process.env.CCS_DIR ?? "../carbon-components-svelte",
);
const docs = path.join(ccsDir, "docs");
const pagesDir = path.join(docs, "src/pages/components");
const require = createRequire(path.join(docs, "package.json"));
const pageNames = flag("pages")?.split(",");
const pages = readdirSync(pagesDir)
  .filter((file) => file.endsWith(".svx"))
  .filter((file) => !pageNames || pageNames.includes(file.replace(".svx", "")))
  .map((file) => path.join(pagesDir, file));

async function loadPipeline(pipeline: Pipeline, production: boolean) {
  const svelte = await import(require.resolve("svelte/compiler"));
  const preprocessors =
    pipeline === "mdsvex"
      ? (await import(path.join(docs, "svelte.config.ts"))).default.preprocess
      : [await createCcsMarkdown(ccsDir, { production })];
  return {
    svelte,
    async run(file: string) {
      const source = readFileSync(file, "utf8");
      return (
        await svelte.preprocess(source, preprocessors, { filename: file })
      ).code as string;
    },
  };
}

/** Child process: one cold pass and one warm pass, as JSON. */
async function child(pipeline: Pipeline, production: boolean) {
  const start = performance.now();
  const { run } = await loadPipeline(pipeline, production);
  const loadMs = performance.now() - start;
  const passes: number[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const passStart = performance.now();
    // biome-ignore lint/performance/noAwaitInLoops: pages run one at a time, as a build would
    for (const file of pages) await run(file);
    passes.push(performance.now() - passStart);
  }
  console.log(JSON.stringify({ loadMs, coldMs: passes[0], warmMs: passes[1] }));
}

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const ms = (value: number) => `${value.toFixed(0)} ms`;

function bench() {
  const runs = Number(flag("runs") ?? 3);
  const mode = flag("mode") ?? "production";
  console.log(
    `${pages.length} pages, NODE_ENV=${mode}, ${runs} runs each (median, [min-max])\n`,
  );
  console.log(
    "pipeline   load       cold pass          warm pass          cold/page  warm/page",
  );
  for (const pipeline of ["mdsvex", "markdown"] as const) {
    const results: { loadMs: number; coldMs: number; warmMs: number }[] = [];
    for (let run = 0; run < runs; run++) {
      const result = spawnSync(
        "bun",
        [import.meta.filename, "--child", pipeline, ...args],
        {
          env: { ...process.env, NODE_ENV: mode, CCS_DIR: ccsDir },
          encoding: "utf8",
        },
      );
      if (result.status !== 0) throw new Error(result.stderr);
      results.push(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}"));
    }
    const cell = (key: "loadMs" | "coldMs" | "warmMs") => {
      const values = results.map((r) => r[key]);
      return `${ms(median(values))} [${Math.min(...values).toFixed(0)}-${Math.max(...values).toFixed(0)}]`;
    };
    const perPage = (key: "coldMs" | "warmMs") =>
      `${(median(results.map((r) => r[key])) / pages.length).toFixed(2)} ms`;
    console.log(
      `${pipeline.padEnd(10)} ${ms(median(results.map((r) => r.loadMs))).padEnd(10)} ${cell("coldMs").padEnd(18)} ${cell("warmMs").padEnd(18)} ${perPage("coldMs").padEnd(10)} ${perPage("warmMs")}`,
    );
  }
}

const HEADINGS_EXPORT = /export const headings = (.*);/;
const TAGS = /<(p|li|th|td|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/g;
const HEADING = /<h([23])\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;
const ANCHOR = /<a\b[^>]*class="heading-anchor"[^>]*>[\s\S]*?<\/a\s*>/g;
const ATTRIBUTES = /\s(?:class|style|align)="[^"]*"/g;
const TAG_WHITESPACE = /<(\w+)\s+>/g;
const WHITESPACE = /\s+/g;
const PREVIEW_CODE = /\scode(?:Raw)?=\{"(?:[^"\\]|\\.)*"\}/g;
const SPACE_BEFORE_CLOSE = /\s+(\/?>)/g;

/** Text and inline markup of each Markdown element, ignoring classes and whitespace. */
function markdownElements(code: string): string[] {
  const html = code
    .replace(PREVIEW_CODE, "")
    .replace(ANCHOR, "")
    .replace(ATTRIBUTES, "")
    .replace(TAG_WHITESPACE, "<$1>")
    .replace(SPACE_BEFORE_CLOSE, "$1")
    .replaceAll("&#123;", "{")
    .replaceAll("&#125;", "}")
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("<br/>", "<br />");
  return [...html.matchAll(TAGS)].map(
    (m) => `<${m[1]}>${m[2].replace(WHITESPACE, " ").trim()}`,
  );
}

async function check() {
  const production = (flag("mode") ?? "development") === "production";
  const mdsvex = await loadPipeline("mdsvex", production);
  const ours = await loadPipeline("markdown", production);
  let compiled = 0;
  let headingMismatches = 0;
  let elementMismatches = 0;
  let elements = 0;
  const warnings = new Map<string, number>();
  for (const file of pages) {
    const name = path.basename(file);
    // biome-ignore lint/performance/noAwaitInLoops: one page at a time keeps output attributable
    const [before, after] = [await mdsvex.run(file), await ours.run(file)];
    try {
      const result = ours.svelte.compile(after, {
        filename: file,
        generate: "client",
      });
      compiled++;
      for (const warning of result.warnings) {
        warnings.set(warning.code, (warnings.get(warning.code) ?? 0) + 1);
      }
    } catch (error) {
      console.log(
        `✗ ${name} does not compile: ${(error as Error).message.split("\n")[0]}`,
      );
    }

    // Headings: mdsvex's side TOC (h2/h3 scraped from HTML) against the export.
    const toc = [...before.matchAll(HEADING)].map(
      (m) =>
        `${m[1]}#${m[2]} ${m[3]
          .replace(ANCHOR, "")
          .replace(/<[^>]+>/g, "")
          .trim()}`,
    );
    const exported = JSON.parse(HEADINGS_EXPORT.exec(after)?.[1] ?? "[]") as {
      id: string;
      text: string;
      depth: number;
    }[];
    const headings = exported
      .filter((h) => h.depth === 2 || h.depth === 3)
      .map((h) => `${h.depth}#${h.id} ${h.text}`);
    for (let i = 0; i < Math.max(toc.length, headings.length); i++) {
      if (toc[i] !== headings[i]) {
        headingMismatches++;
        console.log(
          `  ${name} heading: mdsvex ${JSON.stringify(toc[i])} / markdown ${JSON.stringify(headings[i])}`,
        );
      }
    }

    // Markdown elements, as a multiset.
    const left = markdownElements(before);
    const right = markdownElements(after);
    elements += left.length;
    const counts = new Map<string, number>();
    for (const element of left)
      counts.set(element, (counts.get(element) ?? 0) + 1);
    for (const element of right)
      counts.set(element, (counts.get(element) ?? 0) - 1);
    for (const [element, count] of counts) {
      if (count === 0) continue;
      elementMismatches += Math.abs(count);
      console.log(
        `  ${name} ${count > 0 ? "only mdsvex " : "only markdown"} ${element.slice(0, Number(process.env.WIDTH ?? 160))}`,
      );
    }
  }
  console.log(`\n${compiled}/${pages.length} pages compile`);
  console.log(`warnings: ${JSON.stringify(Object.fromEntries(warnings))}`);
  console.log(
    `headings (h2/h3) differing from mdsvex's TOC: ${headingMismatches}`,
  );
  console.log(
    `Markdown elements differing: ${elementMismatches} of ${elements}`,
  );
}

if (args[0] === "--child") {
  await child(args[1] as Pipeline, process.env.NODE_ENV === "production");
} else if (args.includes("--check")) {
  await check();
} else {
  bench();
}
