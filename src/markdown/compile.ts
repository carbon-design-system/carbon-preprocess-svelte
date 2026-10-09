import type { AlertType, Attributes, Block } from "./blocks";
import { parseDocument } from "./blocks";
import { exampleSource } from "./example";
import { parseFrontmatter, splitFrontmatter } from "./frontmatter";
import {
  escapeText,
  type InlineOptions,
  inlineText,
  renderInline,
} from "./inline";

export interface MarkdownHeading {
  /** The heading's `id`, unique within the page. */
  id: string;
  /** Plain text, without Markdown or tags. */
  text: string;
  /** 1 for `#`, 6 for `######`. */
  depth: number;
}

/** What `transform` sees and may change before rendering. */
export interface MarkdownTree {
  filename: string | undefined;
  /** Parsed frontmatter, exported as `metadata` and passed to the layout. */
  metadata: Record<string, unknown>;
  blocks: Block[];
}

/** Passed to each renderer, for rendering children the default way. */
export interface RenderContext {
  filename: string | undefined;
  metadata: Record<string, unknown>;
  /** Render blocks with the configured renderers. */
  render(blocks: Block[]): Promise<string>;
  /** Render inline Markdown (a paragraph's or heading's `text`). */
  inline(text: string): string;
  /** Escape text for Svelte markup, including `{` and `}`. */
  escape(text: string): string;
  /** Import a `carbon-components-svelte` component the output uses. */
  use(component: string): string;
  /**
   * A live example's standalone source, for a code view: the markup, after
   * a `<script>` with exactly the page-script imports and declarations it
   * uses (and what those use).
   */
  example(markup: string): string;
}

type BlockOf<T extends Block["type"]> = Extract<Block, { type: T }>;
type Renderer<T extends Block["type"]> = (
  block: BlockOf<T>,
  ctx: RenderContext,
) => string | undefined | Promise<string | undefined>;

/** Override how a block renders. Return `undefined` to use the default. */
export type MarkdownRenderers = { [T in Block["type"]]?: Renderer<T> };

export interface MarkdownOptions {
  /**
   * File extensions to convert.
   * @default [".md"]
   */
  extensions?: string[];
  /**
   * Wrap the page in a layout component, given its import path (or a
   * function from filename to path). It receives the frontmatter fields and
   * `headings` as props, and the page as its default slot.
   */
  layout?: string | ((filename: string | undefined) => string | undefined);
  /**
   * Wrap the content in Carbon's `Prose`, which styles the plain HTML
   * Markdown renders. Pass an object to set `Prose` props.
   * @default true
   */
  prose?: boolean | Record<string, string | number | boolean>;
  /**
   * What `Prose` wraps: the whole page, or each run of Markdown between
   * components, inside a `bx--prose-flow` container that spaces them. With `"markdown"`, a top-level block that renders as a
   * component (`<Name`) or a Svelte tag (`{#if}`) sits outside Prose; plain
   * HTML (`<details>`, `<figure>`) stays in the run. Use it when the page
   * renders live examples, so Prose doesn't style their plain elements and a
   * `Prose` inside one isn't nested in the page's.
   * @default "page"
   */
  proseScope?: "page" | "markdown";
  /**
   * Render fenced code blocks with `CodeSnippet type="multi"` (copy button,
   * show more) instead of a plain `<pre>`.
   * @default false
   */
  codeSnippet?: boolean;
  /**
   * How GitHub alerts (`> [!NOTE]`) render: a `<blockquote data-alert>`
   * that `Prose` styles without JavaScript, or an `InlineNotification`.
   * @default "blockquote"
   */
  alerts?: "blockquote" | "InlineNotification";
  /** Alert titles, for translation. Defaults to "Note", "Tip", and so on. */
  alertTitles?: Partial<Record<AlertType, string>>;
  /**
   * Add a `#` link to each heading (Prose's `bx--prose__heading-anchor`).
   * Pass `depths` to limit which headings get one, and `label` for the
   * link's accessible name.
   * @default false
   */
  anchors?:
    | boolean
    | { depths?: number[]; label?: (heading: MarkdownHeading) => string };
  /**
   * Highlight fenced code, with any highlighter. Return the HTML for the
   * inside of `<code>` (Prism's `highlight`), a whole `<pre>` element
   * (Shiki's `codeToHtml`), or `undefined` to leave the block plain. Called
   * once per block at build time; it may be async.
   */
  highlight?: (
    code: string,
    lang: string,
    meta: string,
  ) => string | undefined | Promise<string | undefined>;
  /**
   * Treat `{...}` in text as a Svelte expression. By default braces in
   * prose are literal, so `returns { key, value }` reads as written.
   * @default false
   */
  expressions?: boolean;
  /**
   * Link bare `https://…` and `www.…` URLs in text, as GitHub does.
   * @default true
   */
  autolinks?: boolean;
  /**
   * Text for the footnotes section's (visually hidden) heading and each
   * back link's accessible name, for translation.
   */
  footnoteLabels?: { heading?: string; backref?: (n: number) => string };
  /** Turn heading text into an id. Defaults to GitHub's slugger. */
  slug?: (text: string) => string;
  /**
   * Parse frontmatter, or `false` to read a leading `---` block as Markdown.
   * Defaults to a small YAML subset.
   */
  frontmatter?: false | ((yaml: string) => Record<string, unknown>);
  /**
   * Components to import when the page renders them, by name: a default
   * import from the given path. For components that renderers or the
   * Markdown itself use without a `<script>` import.
   */
  autoImport?: Record<string, string>;
  /** Change the parsed tree before rendering. */
  transform?: (tree: MarkdownTree) => void | Promise<void>;
  /** Override how individual block types render. */
  renderers?: MarkdownRenderers;
  /**
   * The Svelte major version, for `<script module>` (5) versus
   * `<script context="module">` (3, 4).
   * @default 5
   */
  svelte?: 3 | 4 | 5;
}

export interface CompiledMarkdown {
  code: string;
  headings: MarkdownHeading[];
  metadata: Record<string, unknown>;
}

const SLUG_STRIP = /[^\p{L}\p{M}\p{N}\p{Pc} -]/gu;
const SPACE = / /g;
const HOISTED =
  /^<(?:script|style|svelte:(?:head|window|body|document|options))\b/;
const MODULE_SCRIPT = /^<script\b[^>]*\b(?:context=["']module["']|module)\b/;
const SCRIPT = /^<script\b/;
const STYLE = /^<style\b/;
const OPEN_TAG_END = />/;
const FINAL_NEWLINE = /\n$/;
const CLOSE_SCRIPT = /<\/script>\s*$/;

/** InlineNotification kinds and default titles, matching Prose's alert colors. */
const ALERT_KINDS: Record<AlertType, [kind: string, title: string]> = {
  note: ["info", "Note"],
  tip: ["success", "Tip"],
  important: ["info", "Important"],
  warning: ["warning", "Warning"],
  caution: ["error", "Caution"],
};

const ANCHOR_CLASS = "bx--prose__heading-anchor";
const PRE_ELEMENT = /^\s*<pre\b/;
const CODE_CONTENT = /<code\b[^>]*>([\s\S]*)<\/code>\s*<\/pre>\s*$/;
const RUNES = /\$(?:state|derived|effect|props)\s*[.(]/;
const PROPS_RUNE = /\$props\s*\(/;

/** Rendered markup that `proseScope: "markdown"` keeps out of Prose. */
const OUTSIDE_PROSE = /^\s*(?:<[A-Z]|\{)/;

/** GitHub's heading slug (`github-slugger`), for ids that match on GitHub. */
export function githubSlug(text: string): string {
  return text.toLowerCase().replace(SLUG_STRIP, "").replace(SPACE, "-");
}

function attributes(attrs: Attributes | undefined): string {
  if (!attrs) return "";
  return Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${escapeText(value)}"`)
    .join("");
}

function propsOf(props: Record<string, string | number | boolean>): string {
  return Object.entries(props)
    .map(([name, value]) =>
      value === true
        ? ` ${name}`
        : ` ${name}=${typeof value === "string" ? JSON.stringify(value) : `{${value}}`}`,
    )
    .join("");
}

/** Visit every block, including those nested in quotes and lists. */
function* walk(blocks: Block[]): Generator<Block> {
  for (const block of blocks) {
    yield block;
    if (block.type === "blockquote") yield* walk(block.children);
    if (block.type === "list") {
      for (const item of block.items) yield* walk(item.children);
    }
  }
}

/** Parse Markdown and render the body to Svelte markup, without the page shell. */
export async function renderMarkdown(
  source: string,
  options: MarkdownOptions & { filename?: string; ids?: boolean } = {},
): Promise<{
  html: string;
  /** The rendered top-level blocks, marking components and Svelte tags. */
  parts: { svelte: boolean; html: string }[];
  hoisted: string[];
  headings: MarkdownHeading[];
  metadata: Record<string, unknown>;
  components: Set<string>;
}> {
  const { yaml, body } =
    options.frontmatter === false
      ? { yaml: undefined, body: source }
      : splitFrontmatter(source);
  const metadata = yaml ? (options.frontmatter || parseFrontmatter)(yaml) : {};
  const { blocks, refs, footnotes } = parseDocument(body);
  // Footnotes are numbered in the order they're first referenced.
  const cited = new Map<string, { n: number; refs: number }>();
  const footnoteId = (label: string) => githubSlug(label) || "note";
  const textOptions: InlineOptions = {
    refs,
    expressions: options.expressions ?? false,
    autolinks: options.autolinks ?? true,
  };
  const inlineOptions: InlineOptions = {
    ...textOptions,
    footnote(label) {
      const key = label.toLowerCase();
      if (!footnotes.has(key)) return undefined;
      const entry = cited.get(key) ?? { n: cited.size + 1, refs: 0 };
      entry.refs++;
      cited.set(key, entry);
      const id = footnoteId(key);
      const refId =
        entry.refs === 1 ? `fnref-${id}` : `fnref-${id}-${entry.refs}`;
      return `<sup class="footnote-ref"><a href="#fn-${id}" id="${refId}" aria-describedby="footnote-label">${entry.n}</a></sup>`;
    },
  };

  const tree: MarkdownTree = { filename: options.filename, metadata, blocks };
  await options.transform?.(tree);

  // Top-level scripts, styles, and `<svelte:head>`-style elements can't sit
  // inside the layout or `Prose`.
  const hoisted: string[] = [];
  const content: Block[] = [];
  for (const block of tree.blocks) {
    if (block.type === "svelte" && HOISTED.test(block.value)) {
      hoisted.push(block.value);
    } else {
      content.push(block);
    }
  }

  const headings: MarkdownHeading[] = [];
  const headingOf = new Map<Block, MarkdownHeading>();
  if (options.ids !== false) {
    const slug = options.slug ?? githubSlug;
    const seen = new Map<string, number>();
    for (const block of walk(content)) {
      if (block.type !== "heading") continue;
      const text = inlineText(block.text, textOptions);
      if (!block.id) {
        const base = slug(text);
        let id = base;
        while (seen.has(id)) {
          const count = (seen.get(base) ?? 0) + 1;
          seen.set(base, count);
          id = `${base}-${count}`;
        }
        block.id = id;
      }
      seen.set(block.id, seen.get(block.id) ?? 0);
      const heading = { id: block.id, text, depth: block.depth };
      headings.push(heading);
      headingOf.set(block, heading);
    }
  }

  const components = new Set<string>();
  const renderers = options.renderers ?? {};
  const alerts = options.alerts ?? "blockquote";
  const anchors = options.anchors === true ? {} : options.anchors || undefined;
  const ctx: RenderContext = {
    filename: options.filename,
    metadata,
    render: (children) => renderBlocks(children, false),
    inline: (text) => renderInline(text, inlineOptions),
    escape: escapeText,
    use(component) {
      components.add(component);
      return component;
    },
    example: (markup) =>
      exampleSource(
        markup,
        hoisted.find(
          (block) => SCRIPT.test(block) && !MODULE_SCRIPT.test(block),
        ),
      ),
  };

  async function renderBlocks(list: Block[], tight: boolean): Promise<string> {
    const out = await Promise.all(
      list.map((block) => renderBlock(block, tight)),
    );
    return out.join("\n");
  }

  async function renderBlock(block: Block, tight: boolean): Promise<string> {
    const custom = (
      renderers[block.type] as Renderer<typeof block.type> | undefined
    )?.(block as never, ctx);
    const result = custom instanceof Promise ? await custom : custom;
    if (result !== undefined) return result;

    switch (block.type) {
      case "paragraph": {
        const inner = ctx.inline(block.text);
        return tight && !block.attrs
          ? inner
          : `<p${attributes(block.attrs)}>${inner}</p>`;
      }
      case "heading": {
        const id = block.id ? ` id="${escapeText(block.id)}"` : "";
        const heading = headingOf.get(block);
        let anchor = "";
        if (
          anchors &&
          heading &&
          (!anchors.depths || anchors.depths.includes(block.depth))
        ) {
          const label = anchors.label?.(heading) ?? `Link to ${heading.text}`;
          anchor = ` <a class="${ANCHOR_CLASS}" href="#${escapeText(heading.id)}" aria-label="${escapeText(label)}">#</a>`;
        }
        return `<h${block.depth}${id}${attributes(block.attrs)}>${ctx.inline(block.text)}${anchor}</h${block.depth}>`;
      }
      case "code": {
        const highlighted = await options.highlight?.(
          block.value,
          block.lang,
          block.meta,
        );
        const raw = JSON.stringify(block.value.replace(FINAL_NEWLINE, ""));
        const wholePre =
          highlighted !== undefined && PRE_ELEMENT.test(highlighted);
        if (options.codeSnippet) {
          const snippet = ctx.use("CodeSnippet");
          // CodeSnippet renders its own `pre` and `code`: keep the tokens.
          const inner = wholePre
            ? (CODE_CONTENT.exec(highlighted)?.[1] ?? highlighted)
            : highlighted;
          return inner === undefined
            ? `<${snippet} type="multi" code={${raw}} />`
            : `<${snippet} type="multi" code={${raw}}>{@html ${JSON.stringify(inner)}}</${snippet}>`;
        }
        if (wholePre) return `{@html ${JSON.stringify(highlighted)}}`;
        const lang = block.lang
          ? ` class="language-${escapeText(block.lang)}"`
          : "";
        return highlighted === undefined
          ? `<pre><code${lang}>${escapeText(block.value)}</code></pre>`
          : `<pre${lang}><code${lang}>{@html ${JSON.stringify(highlighted)}}</code></pre>`;
      }
      case "thematicBreak":
        return "<hr />";
      case "blockquote": {
        const title = block.alert
          ? (options.alertTitles?.[block.alert] ?? ALERT_KINDS[block.alert][1])
          : "";
        if (block.alert && alerts === "InlineNotification") {
          const [kind] = ALERT_KINDS[block.alert];
          const [only] = block.children;
          const body =
            block.children.length === 1 && only.type === "paragraph"
              ? ctx.inline(only.text)
              : await renderBlocks(block.children, false);
          const notification = ctx.use("InlineNotification");
          return `<${notification} lowContrast hideCloseButton kind="${kind}" title="${title}"><svelte:fragment slot="subtitleChildren">${body}</svelte:fragment></${notification}>`;
        }
        const alert = block.alert
          ? ` data-alert="${block.alert}" data-alert-title="${escapeText(title)}"`
          : "";
        return `<blockquote${alert}>\n${await renderBlocks(block.children, false)}\n</blockquote>`;
      }
      case "list": {
        const tag = block.ordered ? "ol" : "ul";
        const start =
          block.ordered && block.start !== 1 ? ` start="${block.start}"` : "";
        const tasks = block.items.some((item) => item.checked !== undefined);
        const items = await Promise.all(
          block.items.map(async (item) => {
            if (item.checked === undefined) {
              const inner = await renderBlocks(item.children, block.tight);
              const wrap = block.tight || inner === "" ? inner : `\n${inner}\n`;
              return `<li>${wrap}</li>`;
            }
            // A task item: the checkbox and the first paragraph share a
            // `label`, so the checkbox has an accessible name.
            const [first, ...rest] = item.children;
            const text =
              first?.type === "paragraph" ? ctx.inline(first.text) : "";
            const checkbox = `<input type="checkbox" disabled${item.checked ? " checked" : ""} />`;
            const label = `<label>${checkbox} ${text}</label>`;
            const others = first?.type === "paragraph" ? rest : item.children;
            const tail = await renderBlocks(others, block.tight);
            const inner = [block.tight ? label : `<p>${label}</p>`, tail]
              .filter(Boolean)
              .join("\n");
            const wrap = block.tight ? inner : `\n${inner}\n`;
            return `<li class="task-list-item">${wrap}</li>`;
          }),
        );
        const listClass = tasks ? ' class="contains-task-list"' : "";
        return `<${tag}${listClass}${start}>\n${items.join("\n")}\n</${tag}>`;
      }
      case "table": {
        const cell = (tag: string, text: string, column: number) => {
          const align = block.align[column];
          const style = align ? ` style="text-align: ${align}"` : "";
          return `<${tag}${style}>${ctx.inline(text)}</${tag}>`;
        };
        const head = block.head.map((text, column) => cell("th", text, column));
        const rows = block.rows.map(
          (row) =>
            `<tr>\n${row.map((text, column) => cell("td", text, column)).join("\n")}\n</tr>`,
        );
        const tbody =
          rows.length > 0 ? `\n<tbody>\n${rows.join("\n")}\n</tbody>` : "";
        return `<table>\n<thead>\n<tr>\n${head.join("\n")}\n</tr>\n</thead>${tbody}\n</table>`;
      }
      case "svelte":
        return block.value;
    }
  }

  const rendered = await Promise.all(
    content.map((block) => renderBlock(block, false)),
  );
  const parts = rendered.map((html, index) => ({
    svelte: content[index].type === "svelte" && OUTSIDE_PROSE.test(html),
    html,
  }));

  // Referenced footnotes, after the content, as GitHub renders them.
  if (cited.size > 0) {
    const labels = options.footnoteLabels ?? {};
    const items = await Promise.all(
      [...cited]
        .sort((a, b) => a[1].n - b[1].n)
        .map(async ([key, { n }]) => {
          const id = footnoteId(key);
          const inner = await renderBlocks(footnotes.get(key) ?? [], false);
          const back = labels.backref?.(n) ?? `Back to reference ${n}`;
          const link = `<a href="#fnref-${id}" class="footnote-backref" aria-label="${escapeText(back)}">↩</a>`;
          // Like GitHub, the back link ends the note's last paragraph.
          const body = inner.endsWith("</p>")
            ? `${inner.slice(0, -4)} ${link}</p>`
            : `${inner}\n${link}`;
          return `<li id="fn-${id}">\n${body}\n</li>`;
        }),
    );
    const html = `<section class="footnotes" data-footnotes>\n<h2 id="footnote-label" class="bx--assistive-text">${escapeText(labels.heading ?? "Footnotes")}</h2>\n<ol>\n${items.join("\n")}\n</ol>\n</section>`;
    rendered.push(html);
    parts.push({ svelte: false, html });
  }

  return {
    html: rendered.join("\n"),
    parts,
    hoisted,
    headings,
    metadata,
    components,
  };
}

/** Whether the page's own script already names `name` (imports or declares it). */
function declares(script: string | undefined, name: string): boolean {
  return script !== undefined && new RegExp(`\\b${name}\\b`).test(script);
}

/** Insert `code` right after the opening tag of a `<script>` block. */
function prependToScript(script: string, code: string): string {
  const end = OPEN_TAG_END.exec(script);
  if (!end) return script;
  const at = end.index + 1;
  return `${script.slice(0, at)}\n${code}${script.slice(at)}`;
}

/** Insert `code` right before the closing `</script>`. */
function appendToScript(script: string, code: string): string {
  return script.replace(CLOSE_SCRIPT, `\n${code}\n</script>`);
}

/** Convert a Markdown page to a Svelte component. */
export async function compileMarkdown(
  source: string,
  options: MarkdownOptions & { filename?: string } = {},
): Promise<CompiledMarkdown> {
  const rendered = await renderMarkdown(source, options);
  const { headings, metadata, components } = rendered;

  let moduleScript: string | undefined;
  let instanceScript: string | undefined;
  const styles: string[] = [];
  const specials: string[] = [];
  for (const block of rendered.hoisted) {
    if (MODULE_SCRIPT.test(block)) moduleScript = block;
    else if (SCRIPT.test(block)) instanceScript = block;
    else if (STYLE.test(block)) styles.push(block);
    else specials.push(block);
  }

  const prose = options.prose ?? true;
  let body = rendered.html;
  // `proseProps` lets the page's parent set Prose props at runtime, over the
  // build-time ones: `<Guide proseProps={{ variant: "compact" }} />`. Pages
  // whose script already calls `$props()` keep the build-time props only.
  const runtimeProps =
    prose !== false && !PROPS_RUNE.test(instanceScript ?? "");
  if (prose !== false) {
    const open = `<Prose${typeof prose === "object" ? propsOf(prose) : ""}${runtimeProps ? " {...proseProps}" : ""}>`;
    if (options.proseScope === "markdown") {
      // One Prose per run of Markdown blocks; Svelte blocks stay outside.
      const out: string[] = [];
      let run: string[] = [];
      const flush = () => {
        if (run.length > 0) out.push(`${open}\n${run.join("\n")}\n</Prose>`);
        run = [];
      };
      for (const part of rendered.parts) {
        if (part.svelte) {
          flush();
          out.push(part.html);
        } else {
          run.push(part.html);
        }
      }
      flush();
      // Prose's flow container spaces the runs and the components between
      // them (more room before a run that opens with a heading).
      body = `<div class="bx--prose-flow">\n${out.join("\n")}\n</div>`;
      if (body.includes("<Prose")) components.add("Prose");
    } else {
      body = `${open}\n${body}\n</Prose>`;
      components.add("Prose");
    }
  }
  const layout =
    typeof options.layout === "function"
      ? options.layout(options.filename)
      : options.layout;
  if (layout) {
    body = `<MarkdownLayout {...metadata} {headings}>\n${body}\n</MarkdownLayout>`;
  }

  const exports = `export const metadata = ${JSON.stringify(metadata)};\nexport const headings = ${JSON.stringify(headings)};`;
  moduleScript = moduleScript
    ? appendToScript(moduleScript, exports)
    : `<script ${(options.svelte ?? 5) >= 5 ? "module" : 'context="module"'}>\n${exports}\n</script>`;

  const imports: string[] = [];
  // Components the page already imports (or declares) are left alone.
  const missing = [...components].filter(
    (name) => !declares(instanceScript, name),
  );
  if (missing.length > 0) {
    imports.push(
      `import { ${missing.join(", ")} } from "carbon-components-svelte";`,
    );
  }
  if (layout)
    imports.push(`import MarkdownLayout from ${JSON.stringify(layout)};`);
  for (const [name, from] of Object.entries(options.autoImport ?? {})) {
    if (
      new RegExp(`<${name}\\b`).test(body) &&
      !declares(instanceScript, name)
    ) {
      imports.push(`import ${name} from ${JSON.stringify(from)};`);
    }
  }
  if (runtimeProps) {
    imports.push(
      RUNES.test(instanceScript ?? "")
        ? "let { proseProps = {} } = $props();"
        : "export let proseProps = {};",
    );
  }
  if (imports.length > 0) {
    instanceScript = instanceScript
      ? prependToScript(instanceScript, imports.join("\n"))
      : `<script>\n${imports.join("\n")}\n</script>`;
  }

  const code = [moduleScript, instanceScript, ...specials, body, ...styles]
    .filter(Boolean)
    .join("\n");
  return { code: `${code}\n`, headings, metadata };
}
