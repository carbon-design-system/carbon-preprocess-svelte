/**
 * GitHub Flavored Markdown conformance for the Markdown preprocessor's
 * parser: the extension sections of GitHub's spec (tables, task lists,
 * strikethrough, URL autolinks, disallowed raw HTML). Downloads the spec
 * once, renders each example without the page shell, and reports the pass
 * rate per section. `eval-markdown-spec.ts` covers the CommonMark core.
 *
 *   bun scripts/eval-markdown-gfm.ts [--failures]
 *
 * Disallowed raw HTML (GitHub's `tagfilter`) is reported apart: a Svelte
 * page's `<script>` and `<style>` are its own, so they pass through.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderMarkdown } from "../src/markdown/compile";

const BY_DESIGN = new Set(["Disallowed Raw HTML (extension)"]);
const cacheDir = path.resolve("node_modules/.cache/markdown-spec");
const specPath = path.join(cacheDir, "gfm-spec.txt");

if (!existsSync(specPath)) {
  mkdirSync(cacheDir, { recursive: true });
  const response = await fetch(
    "https://raw.githubusercontent.com/github/cmark-gfm/master/test/spec.txt",
  );
  writeFileSync(specPath, await response.text());
}

const FENCE = "`".repeat(32);
const EXAMPLE_START = `${FENCE} example`;
const SECTION = /^#{1,6} (.+\(extension\))$/;
const TAB = /→/g;

interface Example {
  section: string;
  markdown: string;
  html: string;
}

/** The extension sections' examples, in the spec's `example` blocks. */
function readExamples(spec: string): Example[] {
  const examples: Example[] = [];
  let section: string | undefined;
  const lines = spec.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const heading = SECTION.exec(lines[i]);
    if (heading) section = heading[1];
    else if (lines[i].startsWith("#")) section = undefined;
    if (!section || !lines[i].startsWith(EXAMPLE_START)) continue;
    const body: string[] = [];
    for (i++; lines[i] !== FENCE; i++) body.push(lines[i]);
    const split = body.indexOf(".");
    examples.push({
      section,
      markdown: `${body.slice(0, split).join("\n")}\n`.replace(TAB, "\t"),
      html: body
        .slice(split + 1)
        .join("\n")
        .replace(TAB, "\t"),
    });
  }
  return examples;
}

/** Ignore whitespace between tags, and the `{`/`}` escapes Svelte needs. */
function normalize(html: string): string {
  return html
    .replaceAll("&#123;", "{")
    .replaceAll("&#125;", "}")
    .replace(/>\n+/g, ">")
    .replace(/\n+</g, "<")
    .trim();
}

const showFailures = process.argv.includes("--failures");
const sections = new Map<string, { pass: number; total: number }>();
let pass = 0;
let passInScope = 0;
let totalInScope = 0;
const examples = readExamples(readFileSync(specPath, "utf8"));

for (const example of examples) {
  // biome-ignore lint/performance/noAwaitInLoops: examples print in order
  const { html } = await renderMarkdown(example.markdown, {
    ids: false,
    expressions: false,
    frontmatter: false,
    images: false,
  });
  const ok = normalize(html) === normalize(example.html);
  const section = sections.get(example.section) ?? { pass: 0, total: 0 };
  section.total++;
  if (ok) {
    section.pass++;
    pass++;
  }
  sections.set(example.section, section);
  if (!BY_DESIGN.has(example.section)) {
    totalInScope++;
    if (ok) passInScope++;
  }
  if (!ok && showFailures) {
    console.log(
      `--- ${example.section}\n${JSON.stringify(example.markdown)}\nexpected ${JSON.stringify(normalize(example.html))}\nactual   ${JSON.stringify(normalize(html))}`,
    );
  }
}

const percent = (a: number, b: number) => `${((a / b) * 100).toFixed(1)}%`;
for (const [name, { pass: p, total }] of sections) {
  console.log(
    `${BY_DESIGN.has(name) ? "*" : " "} ${name.padEnd(36)} ${String(p).padStart(3)}/${String(total).padEnd(3)} ${percent(p, total)}`,
  );
}
console.log(
  `\nall extension sections: ${pass}/${examples.length} (${percent(pass, examples.length)})`,
);
console.log(
  `excluding * (differs by design): ${passInScope}/${totalInScope} (${percent(passInScope, totalInScope)})`,
);
