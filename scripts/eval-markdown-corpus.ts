/**
 * Real-world Markdown through the preprocessor: READMEs and docs from
 * popular repos. For each file, checks that the compiled page compiles with
 * Svelte, and compares its structure with GitHub's own rendering (through
 * `gh api markdown`): headings, paragraphs, list items, tables, code
 * blocks, quotes, images, and `<details>`, by count. Downloads and GitHub's
 * renders are cached in `node_modules/.cache/markdown-corpus/`.
 *
 *   bun scripts/eval-markdown-corpus.ts [--diff <file>]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compile } from "svelte/compiler";
import { compileMarkdown, markdownToHtml } from "../src/markdown/compile";

/** `owner/repo/branch/path`, as raw.githubusercontent.com serves it. */
const FILES = [
  "sveltejs/svelte/main/README.md",
  "sveltejs/svelte/main/CONTRIBUTING.md",
  "sveltejs/kit/main/README.md",
  "sveltejs/kit/main/documentation/docs/10-getting-started/10-introduction.md",
  "sveltejs/kit/main/documentation/docs/20-core-concepts/10-routing.md",
  "sveltejs/kit/main/documentation/docs/20-core-concepts/20-load.md",
  "pngwn/MDsveX/main/README.md",
  "carbon-design-system/carbon-components-svelte/master/README.md",
  "carbon-design-system/carbon-components-svelte/master/CONTRIBUTING.md",
  "carbon-design-system/carbon/main/README.md",
  "carbon-design-system/carbon-icons-svelte/master/README.md",
  "vitejs/vite/main/README.md",
  "vitejs/vite/main/docs/guide/index.md",
  "vitejs/vite/main/docs/config/index.md",
  "withastro/astro/main/README.md",
  "microsoft/TypeScript/main/README.md",
  "facebook/react/main/README.md",
  "tailwindlabs/tailwindcss/main/README.md",
  "oven-sh/bun/main/README.md",
  "biomejs/biome/main/README.md",
  "microsoft/playwright/main/README.md",
  "github/gitignore/main/README.md",
  "sindresorhus/awesome/main/readme.md",
  "nodejs/node/main/README.md",
  "rust-lang/rust/master/README.md",
  "denoland/deno/main/README.md",
];

/** The structure compared with GitHub's rendering. */
const TAGS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "p",
  "li",
  "table",
  "tr",
  "pre",
  "blockquote",
  "img",
  "details",
  "hr",
];

const cacheDir = path.resolve("node_modules/.cache/markdown-corpus");
mkdirSync(cacheDir, { recursive: true });
const cached = (name: string) =>
  path.join(cacheDir, name.replaceAll("/", "__"));

async function source(file: string): Promise<string | undefined> {
  const at = cached(file);
  if (existsSync(at)) return readFileSync(at, "utf8");
  const response = await fetch(`https://raw.githubusercontent.com/${file}`);
  if (!response.ok) return undefined;
  const text = await response.text();
  writeFileSync(at, text);
  return text;
}

/** GitHub's own rendering of `text`, as GFM. */
function github(file: string, text: string): string {
  const at = `${cached(file)}.github.html`;
  if (existsSync(at)) return readFileSync(at, "utf8");
  const result = spawnSync(
    "gh",
    ["api", "markdown", "-f", `text=${text}`, "-f", "mode=gfm"],
    { encoding: "utf8", maxBuffer: 1 << 26 },
  );
  if (result.status !== 0) throw new Error(result.stderr);
  writeFileSync(at, result.stdout);
  return result.stdout;
}

/** Each tag's count, outside code blocks (a fence can hold markup). */
function counts(html: string): Record<string, number> {
  const outsideCode = html.replace(/<pre[\s>][\s\S]*?<\/pre>/g, "<pre></pre>");
  return Object.fromEntries(
    TAGS.map((tag) => [
      tag,
      outsideCode.match(new RegExp(`<${tag}[\\s>/]`, "g"))?.length ?? 0,
    ]),
  );
}

const diffFor = process.argv.includes("--diff")
  ? process.argv[process.argv.indexOf("--diff") + 1]
  : undefined;
let compiled = 0;
let matching = 0;
let total = 0;

for (const file of FILES) {
  // biome-ignore lint/performance/noAwaitInLoops: one file at a time, in order
  const text = await source(file);
  if (text === undefined) {
    console.log(`?? ${file}: not found`);
    continue;
  }
  total++;
  const problems: string[] = [];

  try {
    const { code } = await compileMarkdown(text, {
      prose: false,
      filename: file,
    });
    compile(code, {
      filename: `${path.basename(file)}.svelte`,
      generate: false,
    });
    compiled++;
  } catch (error) {
    problems.push(`doesn't compile: ${String(error).split("\n")[0]}`);
  }

  const { html } = await markdownToHtml(text, {
    // Keep Svelte blocks: on GitHub, they're HTML.
    svelteBlock: (markup) => markup,
  });
  const ours = counts(html);
  const theirs = counts(github(file, text));
  const differing = TAGS.filter((tag) => ours[tag] !== theirs[tag]);
  if (differing.length === 0) matching++;
  else
    problems.push(
      differing
        .map((tag) => `${tag} ${ours[tag]} vs ${theirs[tag]}`)
        .join(", "),
    );

  console.log(
    `${problems.length ? "✗" : "✓"} ${file}${problems.length ? `\n    ${problems.join("\n    ")}` : ""}`,
  );
  if (diffFor && file.includes(diffFor)) {
    writeFileSync(path.join(cacheDir, "ours.html"), html);
    writeFileSync(path.join(cacheDir, "github.html"), github(file, text));
    console.log(`    wrote ours.html and github.html to ${cacheDir}`);
  }
}

console.log(
  `\n${compiled}/${total} compile with Svelte; ${matching}/${total} match GitHub's structure`,
);
