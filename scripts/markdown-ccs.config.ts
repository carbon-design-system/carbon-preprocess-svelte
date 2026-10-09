/**
 * What carbon-components-svelte's `docs/svelte.config.ts` would look like on
 * the `markdown` preprocessor instead of mdsvex. Each job of the current
 * pipeline maps to an option or hook:
 *
 * - mdsvex layout          → `layout`
 * - `mdsvexPrismHighlighter` → the built-in `highlight` (Carbon syntax
 *                            tokens; no Prism)
 * - `plugin` (Preview)     → `renderers.svelte`: a component block is one
 *                            block even with blank lines inside, and its
 *                            code view comes from `ctx.example`, with the
 *                            page-script imports and declarations it uses
 *                            (the old icon-name guess is gone)
 * - `heroIntro`            → `transform`
 * - `carbonify`            → dropped: the page renders inside `Prose`; the
 *                            h2 section intro keeps its class via `transform`
 * - `rehypeSlug`           → built in (GitHub slugs)
 * - `rehypeHeadingAnchors` → `anchors` (Prose's heading-anchor style)
 * - TOC regex scrape       → the `headings` prop on the layout
 * - auto-import `Preview`, `DocKbd` → `autoImport`
 *
 * Prettier and the docs helpers load from the CCS checkout, so this
 * package doesn't depend on them.
 */
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Block } from "../src/markdown/blocks";
import { highlight } from "../src/markdown/highlight";
import { markdown } from "../src/preprocessors/markdown";

const FILE_SOURCE_SRC = /src="([^"]+)"/;
const DOC_KBD = /^\s*<DocKbd\b/;
const FILE_SOURCE = /^<FileSource/;

export async function createCcsMarkdown(
  ccsDir: string,
  options: { production: boolean },
) {
  const docs = path.join(ccsDir, "docs");
  const require = createRequire(path.join(docs, "package.json"));
  const { format } = await import(require.resolve("prettier"));
  const prettierPluginSvelte = (
    await import(require.resolve("prettier-plugin-svelte"))
  ).default;
  const { stripDocsOnly } = await import(
    path.join(docs, "scripts/strip-docs-only.ts")
  );
  const cache = new Map<string, { codeRaw: string; code: string }>();

  async function formatAndHighlight(source: string) {
    const cached = cache.get(source);
    if (cached) return cached;
    const codeRaw = options.production
      ? await format(source, {
          parser: "svelte",
          plugins: [prettierPluginSvelte],
          svelteSortOrder: "scripts-markup-styles-options",
        })
      : source;
    const result = {
      codeRaw,
      code: highlight(codeRaw, "svelte") ?? codeRaw,
    };
    cache.set(source, result);
    return result;
  }

  return markdown({
    extensions: [".svx"],
    layout: (filename) =>
      filename?.includes(`${path.sep}pages${path.sep}components${path.sep}`)
        ? path.join(docs, "src/layouts/ComponentLayout.svelte")
        : undefined,
    // Prose wraps the Markdown between live examples, not the examples:
    // their plain elements keep their own look, and examples that render
    // Prose aren't nested in the page's.
    prose: { maxWidth: "none" },
    proseScope: "markdown",
    anchors: { depths: [2, 3] },
    autoImport: {
      Preview: "../../components/Preview.svelte",
      DocKbd: "../../components/DocKbd.svelte",
    },
    transform(tree) {
      // heroIntro: leading paragraphs become the page description.
      const intro: Block[] = [];
      while (tree.blocks[0]?.type === "paragraph")
        intro.push(tree.blocks.shift() as Block);
      if (intro.length > 0) {
        tree.metadata.description = intro
          .map((block) => (block.type === "paragraph" ? block.text : ""))
          .join("\n\n");
      }
      // An h2 intro that leads into subsections or a table.
      tree.blocks.forEach((block, index) => {
        const previous = tree.blocks[index - 1];
        const next = tree.blocks[index + 1];
        if (
          block.type === "paragraph" &&
          previous?.type === "heading" &&
          previous.depth === 2 &&
          (next?.type === "table" ||
            (next?.type === "heading" && next.depth >= 3))
        ) {
          block.attrs = {
            class: "bx--type-productive-heading-03 prose-section-intro",
          };
        }
      });
    },
    highlight,
    renderers: {
      async svelte(block, ctx) {
        const value = block.value;
        if (DOC_KBD.test(value)) return `<p>${value}</p>`;
        if (value.startsWith("<!--") || value.startsWith("{")) return value;
        if (FILE_SOURCE.test(value)) {
          const src = FILE_SOURCE_SRC.exec(value)?.[1] ?? "";
          const file = path.join(docs, "src/pages", `${src}.svelte`);
          statSync(file);
          const { codeRaw, code } = await formatAndHighlight(
            stripDocsOnly(readFileSync(file, "utf8")),
          );
          return `<Preview framed src="${src}" codeRaw={${JSON.stringify(codeRaw)}} code={${JSON.stringify(code)}} />`;
        }
        const { codeRaw, code } = await formatAndHighlight(ctx.example(value));
        return `<Preview codeRaw={${JSON.stringify(codeRaw)}} code={${JSON.stringify(code)}}>${value}</Preview>`;
      },
    },
  });
}
