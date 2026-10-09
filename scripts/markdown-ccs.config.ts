/**
 * What carbon-components-svelte's `docs/svelte.config.ts` would look like on
 * the `markdown` preprocessor instead of mdsvex. Each job of the current
 * pipeline maps to an option or hook:
 *
 * - mdsvex layout          → `layout`
 * - `mdsvexPrismHighlighter` → `renderers.code` (same Prism output)
 * - `plugin` (Preview)     → `renderers.svelte`: a component block is one
 *                            block even with blank lines inside
 * - `heroIntro`            → `transform`
 * - `carbonify`            → dropped: the page renders inside `Prose`; the
 *                            h2 section intro keeps its class via `transform`
 * - `rehypeSlug`           → built in (GitHub slugs)
 * - `rehypeHeadingAnchors` → `anchors` (Prose's heading-anchor style)
 * - TOC regex scrape       → the `headings` prop on the layout
 * - auto-import `Preview`, `DocKbd` → `autoImport`
 *
 * Prettier, Prism and the docs helpers load from the CCS checkout, so this
 * package doesn't depend on them.
 */
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Block } from "../src/markdown/blocks";
import { markdown } from "../src/preprocessors/markdown";

type Legacy = { type?: string; name?: string; expression?: Legacy } & Record<
  string,
  unknown
>;

const ICON_NAME = /[A-Z][a-z]*/;
const FILE_SOURCE_SRC = /src="([^"]+)"/;
const DOC_KBD = /^\s*<DocKbd\b/;
const FILE_SOURCE = /^<FileSource/;
const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  html: "markup",
  svg: "markup",
};

export async function createCcsMarkdown(
  ccsDir: string,
  options: { production: boolean },
) {
  const docs = path.join(ccsDir, "docs");
  const require = createRequire(path.join(docs, "package.json"));
  const Prism = require("prismjs");
  for (const lang of ["markup", "css", "clike", "javascript", "typescript"]) {
    require(`prismjs/components/prism-${lang}.js`);
  }
  require("prism-svelte");
  const { format } = await import(require.resolve("prettier"));
  const prettierPluginSvelte = (
    await import(require.resolve("prettier-plugin-svelte"))
  ).default;
  const { parse } = await import(require.resolve("svelte/compiler"));
  const { stripDocsOnly } = await import(
    path.join(docs, "scripts/strip-docs-only.ts")
  );
  const componentApi = JSON.parse(
    readFileSync(path.join(docs, "src/COMPONENT_API.json"), "utf8"),
  );
  const componentNames = new Set<string>(
    componentApi.components.map((c: { moduleName: string }) => c.moduleName),
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
      code: Prism.highlight(codeRaw, Prism.languages.svelte, "svelte"),
    };
    cache.set(source, result);
    return result;
  }

  /** The `<script>` a snippet needs to run on its own: Carbon components, icons, actions. */
  function createImports(source: string): string {
    const components = new Set<string>();
    const icons = new Set<string>();
    const isIcon = (name: string) =>
      ICON_NAME.test(name) && !componentNames.has(name);
    const visit = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const child of node) visit(child);
        return;
      }
      const n = node as Legacy;
      if (
        n.type === "InlineComponent" &&
        n.name &&
        !n.name.startsWith("svelte:") &&
        n.name !== "DocKbd"
      ) {
        (isIcon(n.name) ? icons : components).add(n.name);
      } else if (
        n.type === "MustacheTag" &&
        n.expression?.type === "Identifier" &&
        n.expression.name &&
        isIcon(n.expression.name)
      ) {
        icons.add(n.expression.name);
      } else if (n.type === "Action" && n.name) {
        components.add(n.name);
      }
      for (const [key, value] of Object.entries(n)) {
        if (key !== "start" && key !== "end") visit(value);
      }
    };
    visit(parse(source).html);
    if (components.size === 0) return "";
    const lines = [
      `  import { ${[...components].join(", ")} } from "carbon-components-svelte";`,
    ];
    for (const icon of icons)
      lines.push(
        `  import ${icon} from "carbon-icons-svelte/lib/${icon}.svelte";`,
      );
    return `<script>\n${lines.join("\n")}\n</script>\n\n`;
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
    renderers: {
      code(block, ctx) {
        const raw = block.lang.toLowerCase();
        const key = LANG_ALIASES[raw] ?? raw;
        const grammar = key ? Prism.languages[key] : undefined;
        const inner = grammar
          ? Prism.highlight(block.value, grammar, key)
          : ctx.escape(block.value);
        const lang = raw || "text";
        return `<pre class="language-${lang}">{@html ${JSON.stringify(`<code class="language-${lang}">${inner}</code>`)}}</pre>`;
      },
      async svelte(block) {
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
        const { codeRaw, code } = await formatAndHighlight(
          createImports(value) + value,
        );
        return `<Preview codeRaw={${JSON.stringify(codeRaw)}} code={${JSON.stringify(code)}}>${value}</Preview>`;
      },
    },
  });
}
