import {
  parseCodeMeta,
  renderCodeLines,
  splitHtmlLines,
  stripCodeMarkers,
  terminalLines,
} from "carbon-preprocess-svelte";
import { renderMarkdown } from "carbon-preprocess-svelte/markdown/compile";
import { highlight } from "carbon-preprocess-svelte/markdown/highlight";

const marks = (meta: ReturnType<typeof parseCodeMeta>) =>
  Object.fromEntries(
    [...meta.marks].map(([line, set]) => [line, [...set].sort().join(" ")]),
  );

describe("parseCodeMeta", () => {
  test("reads Docusaurus, VitePress, and Expressive Code fence metadata", () => {
    const meta = parseCodeMeta(
      'title="+page.svelte" {1,3-4} ins={6} del={5} focus={3} showLineNumbers=10 wrap',
    );
    expect(meta.title).toBe("+page.svelte");
    expect(meta.lineNumbers).toBe(10);
    expect(meta.wrap).toBe(true);
    expect(marks(meta)).toEqual({
      1: "highlight",
      3: "focus highlight",
      4: "highlight",
      5: "del",
      6: "ins",
    });
  });

  test("accepts the other spellings", () => {
    expect(
      parseCodeMeta("filename='a.js' mark={2} add={3} remove={4} lineNumbers")
        .title,
    ).toBe("a.js");
    expect(marks(parseCodeMeta("mark={2} add={3} remove={4}"))).toEqual({
      2: "highlight",
      3: "ins",
      4: "del",
    });
    expect(parseCodeMeta("").marks.size).toBe(0);
  });
});

describe("stripCodeMarkers", () => {
  test("removes `[!code …]` comments in any comment syntax and records their marks", () => {
    const found = new Map();
    const code = stripCodeMarkers(
      [
        "a(); // [!code ++]",
        "b(); /* [!code --] */",
        "<p /> <!-- [!code highlight] -->",
        "x # [!code focus:2]",
        "y",
      ].join("\n"),
      found,
    );
    expect(code).toBe("a();\nb();\n<p />\nx\ny");
    expect(
      Object.fromEntries([...found].map(([l, s]) => [l, [...s].join(" ")])),
    ).toEqual({
      1: "ins",
      2: "del",
      3: "highlight",
      4: "focus",
      5: "focus",
    });
  });
});

describe("splitHtmlLines", () => {
  test("closes and reopens elements that span a line break", () => {
    expect(splitHtmlLines('<span class="c">/* a\nb */</span> x')).toEqual([
      '<span class="c">/* a</span>',
      '<span class="c">b */</span> x',
    ]);
  });
});

describe("renderCodeLines", () => {
  test("leaves code without line features alone", async () => {
    expect(await renderCodeLines("let a;\n", "js", "")).toBeUndefined();
  });

  test("marks lines, and copies without deleted lines", async () => {
    const lines = await renderCodeLines(
      "a\nb\nc\n",
      "js",
      "{1} del={2} ins={3}",
    );
    expect(lines?.html).toBe(
      '<span class="line" data-highlight>a</span>\n<span class="line" data-del>b</span>\n<span class="line" data-ins>c</span>',
    );
    expect(lines?.copy).toBe("a\nc");
  });

  test("renders a terminal session: prompts outside the copy text, output plain", async () => {
    const lines = await renderCodeLines(
      "$ npm i x\nadded 1 package\n",
      "sh",
      "",
      (code) => highlight(code, "sh"),
    );
    expect(lines?.html).toBe(
      '<span class="line"><span class="prompt" aria-hidden="true">$ </span><span class="tok-function">npm</span> i x</span>\n<span class="line" data-output>added 1 package</span>',
    );
    expect(lines?.copy).toBe("npm i x");
    expect(lines?.attributes).toEqual({ "data-terminal": "" });
  });
});

describe("terminalLines", () => {
  test("keeps a command's `\\` continuation lines with the command", () => {
    const lines = terminalLines("$ docker run \\\n  -p 80:80 nginx\nok", "sh");
    expect([...(lines?.commands ?? [])]).toEqual([1, 2]);
    expect([...(lines?.prompts ?? [])]).toEqual([1]);
    expect(lines?.code).toBe("docker run \\\n  -p 80:80 nginx\nok");
  });

  test("leaves shell code without prompts, and other languages, alone", () => {
    expect(terminalLines("npm i x", "sh")).toBeUndefined();
    expect(terminalLines("$ x", "js")).toBeUndefined();
  });
});

describe("markdown() fenced code with line features", () => {
  test("renders a title, line numbers, and marked lines", async () => {
    const { html } = await renderMarkdown(
      '```js title="a.js" {2} showLineNumbers=3\nlet a;\nlet b;\n```',
    );
    expect(html).toBe(
      '<div class="code-block">\n<div class="code-block__title">a.js</div>\n<pre class="language-js" data-line-numbers="3"><code class="language-js" style="counter-reset: line 2">{@html "<span class=\\"line\\">let a;</span>\\n<span class=\\"line\\" data-highlight>let b;</span>"}</code></pre>\n</div>',
    );
  });

  test("renders a title on its own", async () => {
    const { html } = await renderMarkdown('```js title="a.js"\nx\n```');
    expect(html).toContain('<div class="code-block__title">a.js</div>');
  });

  test("passes the copy text to CodeSnippet", async () => {
    const { html } = await renderMarkdown("```sh\n$ bun add x\nok\n```", {
      codeSnippet: true,
    });
    expect(html).toContain(
      '<CodeSnippet type="multi" code={"bun add x"} data-terminal>',
    );
  });
});

describe("::: code-group", () => {
  const source = [
    "::: code-group",
    "",
    "```svelte [App.svelte]",
    "<Counter />",
    "```",
    "",
    '```js title="counter.js"',
    "export let count = 0;",
    "```",
    "",
    ":::",
    "",
    "After.",
  ].join("\n");

  test("groups its blocks, each under its label, when no renderer handles it", async () => {
    const { html } = await renderMarkdown(source);
    expect(html).toContain(
      '<div class="code-group">\n<div class="code-block">\n<div class="code-block__title">App.svelte</div>',
    );
    expect(html).toContain('<div class="code-block__title">counter.js</div>');
    expect(html.endsWith("</div>\n</div>\n<p>After.</p>")).toBe(true);
  });

  test("passes the group to `renderers.codeGroup`", async () => {
    const { html } = await renderMarkdown(source, {
      renderers: {
        codeGroup: (block) =>
          `<Tabs files={${JSON.stringify(block.children.map((child) => (child.type === "code" ? child.meta : child.type)))}} />`,
      },
    });
    expect(html).toBe(
      '<Tabs files={["[App.svelte]","title=\\"counter.js\\""]} />\n<p>After.</p>',
    );
  });

  test("ignores a `:::` inside a fence", async () => {
    const { html } = await renderMarkdown(
      "::: code-group\n```md [a.md]\n:::\n```\n:::",
    );
    expect(html).toContain("a.md");
    expect(html).toContain(":::");
  });
});
