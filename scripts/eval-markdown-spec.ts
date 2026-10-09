/**
 * CommonMark spec conformance for the Markdown preprocessor's parser.
 * Downloads the spec examples once, renders each without the page shell,
 * and reports the pass rate per section.
 *
 *   bun scripts/eval-markdown-spec.ts [--failures <section>]
 *
 * Two sections differ by design and are reported apart: indented code blocks
 * are off (indentation belongs to Svelte markup), and HTML blocks follow
 * Svelte, running to the matching close tag instead of the first blank line.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderMarkdown } from "../src/markdown/compile";

const VERSION = "0.31.2";
const BY_DESIGN = new Set(["Indented code blocks", "HTML blocks"]);
const cacheDir = path.resolve("node_modules/.cache/markdown-spec");
const specPath = path.join(cacheDir, `commonmark-${VERSION}.json`);

if (!existsSync(specPath)) {
  mkdirSync(cacheDir, { recursive: true });
  const response = await fetch(
    `https://spec.commonmark.org/${VERSION}/spec.json`,
  );
  writeFileSync(specPath, await response.text());
}

interface Example {
  markdown: string;
  html: string;
  example: number;
  section: string;
}

const examples: Example[] = JSON.parse(readFileSync(specPath, "utf8"));
const FENCE = /^ {0,3}(?:```|~~~)/m;

/** Examples whose expected output has an indented code block, which is off. */
function needsIndentedCode(example: Example): boolean {
  return (
    example.html.includes("<pre><code") &&
    (example.html.match(/<pre>/g)?.length ?? 0) >
      (example.markdown.match(new RegExp(FENCE.source, "gm"))?.length ?? 0) / 2
  );
}

/** Ignore whitespace between tags and the `{`/`}` escapes Svelte needs. */
function normalize(html: string): string {
  return html
    .replaceAll("&#123;", "{")
    .replaceAll("&#125;", "}")
    .replace(/>\n+/g, ">")
    .replace(/\n+</g, "<")
    .trim();
}

const failuresFor = process.argv.includes("--failures")
  ? process.argv[process.argv.indexOf("--failures") + 1]
  : undefined;
const sections = new Map<string, { pass: number; total: number }>();
let pass = 0;
let passInScope = 0;
let totalInScope = 0;

for (const example of examples) {
  // biome-ignore lint/performance/noAwaitInLoops: examples print in order
  const { html } = await renderMarkdown(example.markdown, {
    ids: false,
    expressions: false,
    frontmatter: false,
    autolinks: false,
  });
  const ok = normalize(html) === normalize(example.html);
  const section = sections.get(example.section) ?? { pass: 0, total: 0 };
  section.total++;
  if (ok) {
    section.pass++;
    pass++;
  }
  sections.set(example.section, section);
  if (!BY_DESIGN.has(example.section) && !needsIndentedCode(example)) {
    totalInScope++;
    if (ok) passInScope++;
  }
  if (!ok && failuresFor === example.section) {
    console.log(
      `--- example ${example.example}\n${JSON.stringify(example.markdown)}\nexpected ${JSON.stringify(normalize(example.html))}\nactual   ${JSON.stringify(normalize(html))}`,
    );
  }
}

const percent = (a: number, b: number) => `${((a / b) * 100).toFixed(1)}%`;
for (const [name, { pass: p, total }] of sections) {
  console.log(
    `${BY_DESIGN.has(name) ? "*" : " "} ${name.padEnd(42)} ${String(p).padStart(3)}/${String(total).padEnd(3)} ${percent(p, total)}`,
  );
}
console.log(
  `\nall sections: ${pass}/${examples.length} (${percent(pass, examples.length)})`,
);
console.log(
  `excluding * and indented-code examples (differ by design): ${passInScope}/${totalInScope} (${percent(passInScope, totalInScope)})`,
);
