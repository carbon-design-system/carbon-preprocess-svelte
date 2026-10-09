import { markdown } from "carbon-preprocess-svelte";
import {
  compileMarkdown,
  renderMarkdown,
} from "carbon-preprocess-svelte/markdown/compile";
import { parseFrontmatter } from "carbon-preprocess-svelte/markdown/frontmatter";
import { compile } from "svelte/compiler";

const body = async (source: string, options = {}) =>
  (await renderMarkdown(source, options)).html;

describe("renderMarkdown", () => {
  test("renders CommonMark blocks and inlines", async () => {
    expect(
      await body(
        '# Title\n\nSome *em*, **strong**, `code` and a [link](/a "t").\n\n---',
      ),
    ).toBe(
      '<h1 id="title">Title</h1>\n<p>Some <em>em</em>, <strong>strong</strong>, <code>code</code> and a <a href="/a" title="t">link</a>.</p>\n<hr />',
    );
  });

  test("escapes braces in prose so they read as text", async () => {
    expect(await body("Returns { key, value } and `{ a }`.")).toBe(
      "<p>Returns &#123; key, value &#125; and <code>&#123; a &#125;</code>.</p>",
    );
  });

  test("passes braces through as expressions when `expressions` is set", async () => {
    expect(await body("Count: {count}", { expressions: true })).toBe(
      "<p>Count: {count}</p>",
    );
  });

  test("keeps a component block whole across blank lines", async () => {
    const source = `<Stack>
  <Button />

  <Button on:click={() => { open = !open; }} />
</Stack>

After.`;
    expect(await body(source)).toBe(
      `<Stack>
  <Button />

  <Button on:click={() => { open = !open; }} />
</Stack>
<p>After.</p>`,
    );
  });

  test("ignores `>` and quotes inside attribute expressions", async () => {
    const source = `<Button disabled={a > b} on:click="{() => log("x")}">

Label

</Button>`;
    expect(await body(source)).toBe(source);
  });

  test("reads a line that opens with inline markup as a paragraph", async () => {
    expect(await body('<Kbd label="Tab" /> moves `focus`.')).toBe(
      '<p><Kbd label="Tab" /> moves <code>focus</code>.</p>',
    );
  });

  test("keeps a paragraph whole when a line starts with a component", async () => {
    expect(await body('Press\n<Kbd label="Enter" /> to `submit`.')).toBe(
      '<p>Press\n<Kbd label="Enter" /> to <code>submit</code>.</p>',
    );
  });

  test("passes `{#if}` lines through and parses the Markdown between", async () => {
    expect(await body("{#if open}\n\n**Open**\n\n{/if}")).toBe(
      "{#if open}\n<p><strong>Open</strong></p>\n{/if}",
    );
  });

  test("renders GFM tables with alignment, inline markup and escaped pipes", async () => {
    expect(await body("| a | b |\n|:--|--:|\n| `x \\| y` | **2** |")).toBe(
      '<table>\n<thead>\n<tr>\n<th style="text-align: left">a</th>\n<th style="text-align: right">b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td style="text-align: left"><code>x | y</code></td>\n<td style="text-align: right"><strong>2</strong></td>\n</tr>\n</tbody>\n</table>',
    );
  });

  test("renders tight, loose, nested, and task lists", async () => {
    expect(await body("- a\n  - b\n- [x] c")).toBe(
      '<ul class="contains-task-list">\n<li>a\n<ul>\n<li>b</li>\n</ul></li>\n<li class="task-list-item"><label><input type="checkbox" disabled checked /> c</label></li>\n</ul>',
    );
    expect(await body("- [ ] a\n\n  more")).toBe(
      '<ul class="contains-task-list">\n<li class="task-list-item">\n<p><label><input type="checkbox" disabled /> a</label></p>\n<p>more</p>\n</li>\n</ul>',
    );
    expect(await body("1. a\n\n2. b")).toBe(
      "<ol>\n<li>\n<p>a</p>\n</li>\n<li>\n<p>b</p>\n</li>\n</ol>",
    );
  });

  test("links bare URLs and emails, but not version strings", async () => {
    expect(
      await body(
        "See https://a.example/x_(y)., www.b.example, a@c.example, pkg@1.2.3.",
      ),
    ).toBe(
      '<p>See <a href="https://a.example/x_(y)">https://a.example/x_(y)</a>., <a href="http://www.b.example">www.b.example</a>, <a href="mailto:a@c.example">a@c.example</a>, pkg@1.2.3.</p>',
    );
    expect(
      await body("`https://a.example` and https://b", { autolinks: false }),
    ).toBe("<p><code>https://a.example</code> and https://b</p>");
  });

  test("renders footnotes at the end, numbered by first reference", async () => {
    const html = await body(
      "A[^b] B[^a] again[^b] missing[^x].\n\n[^a]: Note A.\n[^b]: Note B.\n\n    More of B.",
    );
    expect(html).toContain(
      '<a href="#fn-b" id="fnref-b" aria-describedby="footnote-label">1</a>',
    );
    expect(html).toContain('id="fnref-b-2"');
    expect(html).toContain("missing[^x].");
    expect(html).toContain(
      '<li id="fn-b">\n<p>Note B.</p>\n<p>More of B.</p>\n<a href="#fnref-b" class="footnote-backref" aria-label="Back to reference 1">↩</a>\n</li>',
    );
    expect(html.indexOf('id="fn-b"')).toBeLessThan(html.indexOf('id="fn-a"'));
  });

  test("renders a hard break without an extra blank line", async () => {
    expect(await body("a  \nb")).toBe("<p>a<br />\nb</p>");
  });

  test("resolves reference links defined later in the page", async () => {
    expect(
      await body("[Carbon][c]\n\n[c]: https://carbondesignsystem.com"),
    ).toBe('<p><a href="https://carbondesignsystem.com">Carbon</a></p>');
  });

  test("renders fenced code escaped, or through `highlight`", async () => {
    expect(await body("```js\nconst a = { b: 1 };\n```")).toBe(
      '<pre><code class="language-js">const a = &#123; b: 1 &#125;;\n</code></pre>',
    );
    expect(
      await body("```js\nlet a;\n```", {
        highlight: (code: string) => `<span class="k">${code.trim()}</span>`,
      }),
    ).toBe(
      '<pre class="language-js"><code class="language-js">{@html "<span class=\\"k\\">let a;</span>"}</code></pre>',
    );
  });

  test("passes a highlighter's whole `<pre>` through", async () => {
    const shiki = (code: string) =>
      `<pre class="shiki" style="color:var(--shiki-foreground)"><code><span>${code.trim()}</span></code></pre>`;
    expect(await body("```js\nlet a;\n```", { highlight: shiki })).toBe(
      '{@html "<pre class=\\"shiki\\" style=\\"color:var(--shiki-foreground)\\"><code><span>let a;</span></code></pre>"}',
    );
    expect(
      await body("```js\nlet a;\n```", { highlight: shiki, codeSnippet: true }),
    ).toBe(
      '<CodeSnippet type="multi" code={"let a;"}>{@html "<span>let a;</span>"}</CodeSnippet>',
    );
  });

  test("maps fenced code to CodeSnippet when `codeSnippet` is set", async () => {
    expect(await body("```\nnpm i\n```", { codeSnippet: true })).toBe(
      '<CodeSnippet type="multi" code={"npm i"} />',
    );
  });

  test("renders GitHub alerts as Prose alerts, or as InlineNotification", async () => {
    expect(await body("> [!NOTE]\n> Plain.")).toBe(
      '<blockquote data-alert="note" data-alert-title="Note">\n<p>Plain.</p>\n</blockquote>',
    );
    expect(
      await body("> [!TIP]\n> Plain.", { alertTitles: { tip: "Astuce" } }),
    ).toContain('data-alert-title="Astuce"');
    expect(
      await body("> [!WARNING]\n> Mind the **gap**.", {
        alerts: "InlineNotification",
      }),
    ).toBe(
      '<InlineNotification lowContrast hideCloseButton kind="warning" title="Warning"><svelte:fragment slot="subtitleChildren">Mind the <strong>gap</strong>.</svelte:fragment></InlineNotification>',
    );
  });

  test("adds heading anchors when `anchors` is set", async () => {
    expect(await body("## Set `up`", { anchors: true })).toBe(
      '<h2 id="set-up">Set <code>up</code> <a class="bx--prose__heading-anchor" href="#set-up" aria-label="Link to Set up">#</a></h2>',
    );
    expect(
      await body("# A\n\n## B", {
        anchors: { depths: [2], label: (h: { text: string }) => `§ ${h.text}` },
      }),
    ).toBe(
      '<h1 id="a">A</h1>\n<h2 id="b">B <a class="bx--prose__heading-anchor" href="#b" aria-label="§ B">#</a></h2>',
    );
  });

  test("gives headings unique GitHub-style ids and lists them", async () => {
    const { headings, html } = await renderMarkdown(
      "## Props & `events`\n\n## Props & `events`\n\n### Ünïcode ✓",
    );
    expect(headings).toEqual([
      { id: "props--events", text: "Props & events", depth: 2 },
      { id: "props--events-1", text: "Props & events", depth: 2 },
      { id: "ünïcode-", text: "Ünïcode ✓", depth: 3 },
    ]);
    expect(html).toContain('<h2 id="props--events-1">');
  });

  test("lets `transform` and `renderers` change the output", async () => {
    const html = await body("Intro.\n\n## Title\n\n<Demo />", {
      transform(tree: {
        blocks: { type: string }[];
        metadata: Record<string, unknown>;
      }) {
        tree.blocks.shift();
        tree.metadata.description = "Intro.";
      },
      renderers: {
        svelte: (block: { value: string }) =>
          `<Preview>${block.value}</Preview>`,
        heading: () => undefined,
      },
    });
    expect(html).toBe('<h2 id="title">Title</h2>\n<Preview><Demo /></Preview>');
  });
});

describe("compileMarkdown", () => {
  test("exports metadata and headings, and wraps the page in Prose and the layout", async () => {
    const { code } = await compileMarkdown(
      "---\ntitle: Guide\n---\n\n# Guide\n\nHello.",
      {
        layout: "./Layout.svelte",
      },
    );
    expect(code).toBe(`<script module>
export const metadata = {"title":"Guide"};
export const headings = [{"id":"guide","text":"Guide","depth":1}];
</script>
<script>
import { Prose } from "carbon-components-svelte";
import MarkdownLayout from "./Layout.svelte";
export let proseProps = {};
</script>
<MarkdownLayout {...metadata} {headings}>
<Prose {...proseProps}>
<h1 id="guide">Guide</h1>
<p>Hello.</p>
</Prose>
</MarkdownLayout>
`);
  });

  test("hoists scripts, styles, and svelte:head out of the content", async () => {
    const { code } = await compileMarkdown(
      `<script context="module">\n  export const prerender = true;\n</script>\n\n<script>\n  import { Button } from "carbon-components-svelte";\n</script>\n\n<svelte:head><title>T</title></svelte:head>\n\n<Button />\n\n<style>\n  p { color: red; }\n</style>`,
      { svelte: 4, prose: { variant: "compact" } },
    );
    expect(code).toBe(`<script context="module">
  export const prerender = true;

export const metadata = {};
export const headings = [];
</script>
<script>
import { Prose } from "carbon-components-svelte";
export let proseProps = {};
  import { Button } from "carbon-components-svelte";
</script>
<svelte:head><title>T</title></svelte:head>
<Prose variant="compact" {...proseProps}>
<Button />
</Prose>
<style>
  p { color: red; }
</style>
`);
  });

  test('wraps only Markdown runs in Prose with `proseScope: "markdown"`', async () => {
    const { code } = await compileMarkdown(
      "Intro.\n\n<Demo />\n\n<details><summary>S</summary></details>\n\n{#if a}\n\nMore.\n\n{/if}",
      { proseScope: "markdown" },
    );
    expect(code).toContain(
      "<Prose {...proseProps}>\n<p>Intro.</p>\n</Prose>\n<Demo />\n<Prose {...proseProps}>\n<details><summary>S</summary></details>\n</Prose>\n{#if a}\n<Prose {...proseProps}>\n<p>More.</p>\n</Prose>\n{/if}",
    );
  });

  test("declares `proseProps` for runtime Prose props, with runes when the page uses them", async () => {
    const runes = await compileMarkdown(
      "<script>\n  let open = $state(false);\n</script>\n\nHi",
    );
    expect(runes.code).toContain("let { proseProps = {} } = $props();");
    const own = await compileMarkdown(
      "<script>\n  let { title } = $props();\n</script>\n\nHi",
    );
    expect(own.code).not.toContain("proseProps");
    expect(own.code).toContain("<Prose>");
  });

  test("auto-imports components the page renders but doesn't import", async () => {
    const { code } = await compileMarkdown('Press <Kbd label="Tab" />.', {
      prose: false,
      autoImport: { Kbd: "$lib/Kbd.svelte", Unused: "$lib/Unused.svelte" },
    });
    expect(code).toContain('import Kbd from "$lib/Kbd.svelte";');
    expect(code).not.toContain("Unused");
  });

  test("compiles with Svelte 5", async () => {
    const { code } = await compileMarkdown(
      "# Hi { there }\n\n<button on:click={() => count++}>\n\n  {count}\n\n</button>\n\n> [!TIP]\n> Done.\n\n```js\nlet a = {};\n```",
      { codeSnippet: true, alerts: "InlineNotification", anchors: true },
    );
    expect(() => compile(code, { filename: "page.md" })).not.toThrow();
  });
});

describe("parseFrontmatter", () => {
  test("reads scalars, flow sequences, block lists, and block scalars", () => {
    expect(
      parseFrontmatter(
        'title: "A: b"\ncount: 3\ndraft: false\ncomponents: ["Button", "ButtonSkeleton"]\ntags: [a, b]\nauthors:\n  - Ann\n  - Bo\nsummary: >\n  one\n  two\nplain: text # comment',
      ),
    ).toEqual({
      title: "A: b",
      count: 3,
      draft: false,
      components: ["Button", "ButtonSkeleton"],
      tags: ["a", "b"],
      authors: ["Ann", "Bo"],
      summary: "one two",
      plain: "text",
    });
  });
});

describe("markdown preprocessor", () => {
  // The dev-dependency carbon-components-svelte predates Prose.
  test("uses Prose only when the installed Carbon has it", async () => {
    const auto = await markdown().markup({ content: "Hi", filename: "a.md" });
    expect(auto?.code).not.toContain("Prose");

    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const forced = markdown({ prose: true });
    await forced.markup({ content: "Hi", filename: "a.md" });
    const second = await forced.markup({ content: "Hi", filename: "b.md" });
    expect(second?.code).toContain("<Prose {...proseProps}>");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("has no Prose");
    warn.mockRestore();
  });

  test("converts only files with a matching extension", async () => {
    const preprocessor = markdown({ extensions: [".svx"], svelte: 5 });
    expect(
      await preprocessor.markup({ content: "# A", filename: "a.svelte" }),
    ).toBeUndefined();
    expect(
      await preprocessor.markup({
        content: "# A",
        filename: "/app/node_modules/x/a.svx",
      }),
    ).toBeUndefined();
    const result = await preprocessor.markup({
      content: "# A",
      filename: "a.svx",
    });
    expect(result?.code).toContain('<h1 id="a">A</h1>');
  });
});
