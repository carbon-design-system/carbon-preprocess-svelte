import {
  ansiToHtml,
  carbonCodeIcon,
  carbonCodeIconName,
  parseAnsi,
  parseCodeMeta,
  prepareFence,
  renderCodeLines,
  stripAnsi,
} from "carbon-preprocess-svelte";
import {
  compileMarkdown,
  renderMarkdown,
} from "carbon-preprocess-svelte/markdown/compile";

const ESC = "\u001b";

describe("parseCodeMeta: status, variant, theme, icon", () => {
  test("reads `kind`, `label`, `variant`, `theme`, and `icon`", () => {
    const meta = parseCodeMeta(
      'kind="warning" label="Deprecated" variant="compact" theme="g100" icon="LogoPython"',
    );
    expect(meta).toMatchObject({
      kind: "warning",
      label: "Deprecated",
      variant: "compact",
      theme: "g100",
      icon: "LogoPython",
      copy: true,
    });
  });

  test("`do` and `dont` set a status and a label; `dont` turns copying off unless `copy` is set", () => {
    expect(parseCodeMeta("do")).toMatchObject({
      kind: "success",
      label: "Do",
      copy: true,
    });
    expect(parseCodeMeta("dont")).toMatchObject({
      kind: "error",
      label: "Don't",
      copy: false,
    });
    expect(parseCodeMeta("dont copy")).toMatchObject({ copy: true });
    expect(parseCodeMeta('dont label="Avoid"').label).toBe("Avoid");
  });

  test("a kind without a label gets one; an unknown kind is ignored", () => {
    expect(parseCodeMeta("kind=error").label).toBe("Error");
    expect(parseCodeMeta("kind=info").label).toBe("Note");
    expect(parseCodeMeta("kind=loud").kind).toBeUndefined();
  });
});

describe("ANSI", () => {
  test("splits styled runs and drops the sequences", () => {
    const { runs } = parseAnsi(
      `${ESC}[1;32m✓${ESC}[0m 12 passed ${ESC}[2K${ESC}[31m1 failed${ESC}[39m`,
    );
    expect(runs).toEqual([
      { text: "✓", style: { bold: true, fg: "green" } },
      { text: " 12 passed ", style: {} },
      { text: "1 failed", style: { fg: "red" } },
    ]);
  });

  test("maps 256-color and truecolor to a color the stylesheet adapts", () => {
    expect(ansiToHtml(`${ESC}[38;5;208mwarn${ESC}[0m`).html).toBe(
      '<span class="ansi-rgb" style="--ansi-fg: #ff8700">warn</span>',
    );
    expect(ansiToHtml(`${ESC}[38;5;9mx`).html).toBe(
      '<span class="ansi-bright-red">x</span>',
    );
    expect(ansiToHtml(`${ESC}[48;2;10;20;30mx`).html).toBe(
      '<span class="ansi-bg-rgb" style="--ansi-bg: #0a141e">x</span>',
    );
  });

  test("escapes text, carries style across lines, and reads typed escapes when asked", () => {
    const first = ansiToHtml(`${ESC}[33m<a>`);
    expect(first.html).toBe('<span class="ansi-yellow">&lt;a&gt;</span>');
    expect(ansiToHtml("next", { style: first.style }).html).toBe(
      '<span class="ansi-yellow">next</span>',
    );
    expect(stripAnsi("\\e[31mred\\e[0m", true)).toBe("red");
    expect(stripAnsi("\\e[31mred")).toBe("\\e[31mred");
  });

  test("colors terminal output and `ansi` blocks; copy has no sequences", async () => {
    const session = await renderCodeLines(
      `$ bun test\n${ESC}[32mpass${ESC}[0m`,
      "sh",
      "",
    );
    expect(session?.html).toContain(
      '<span class="line" data-output><span class="ansi-green">pass</span></span>',
    );
    expect(session?.copy).toBe("bun test");
    const block = await renderCodeLines("\\e[1mbold\\e[0m plain", "ansi", "");
    expect(block?.html).toBe(
      '<span class="line"><span class="ansi-bold">bold</span> plain</span>',
    );
    expect(block?.copy).toBe("bold plain");
    expect(block?.attributes).toEqual({ "data-ansi": "" });
  });
});

describe("carbonCodeIcon", () => {
  test("picks a Carbon icon by file name, then language, then a generic one", () => {
    const file = (title: string | undefined, lang = "", terminal = false) =>
      carbonCodeIconName({ type: "file", title, lang, terminal });
    expect(file("src/App.svelte")).toBe("LogoSvelte");
    expect(file("package.json")).toBe("LogoNpm");
    expect(file("config.yaml")).toBe("DocumentConfiguration");
    expect(file(undefined, "python")).toBe("LogoPython");
    expect(file("notes", "rust")).toBe("Code");
    expect(file("x", "sh", true)).toBe("Terminal");
    expect(file(undefined, "diff-svelte")).toBe("LogoSvelte");
    expect(
      carbonCodeIconName({
        type: "file",
        title: "x.js",
        lang: "js",
        terminal: false,
        name: "Rocket",
      }),
    ).toBe("Rocket");
    expect(carbonCodeIcon({ type: "status", status: "error" })).toEqual({
      name: "ErrorFilled",
      from: "carbon-icons-svelte/lib/ErrorFilled.svelte",
    });
  });
});

describe("code block headers", () => {
  test("a status and an icon, with the icons imported", async () => {
    const { code } = await compileMarkdown(
      '```svelte title="App.svelte" dont theme="g100"\n<p />\n```',
      {
        prose: false,
        codeIcons: carbonCodeIcon,
      },
    );
    expect(code).toContain(
      'import MdLogoSvelte from "carbon-icons-svelte/lib/LogoSvelte.svelte";',
    );
    expect(code).toContain(
      'import MdErrorFilled from "carbon-icons-svelte/lib/ErrorFilled.svelte";',
    );
    expect(code).toContain(
      `<div class="code-block" data-kind="error" theme="g100">\n<div class="code-block__header"><MdLogoSvelte class="code-block__icon" /><span class="code-block__title">App.svelte</span><span class="code-block__status"><MdErrorFilled class="code-block__icon" />Don't</span></div>`,
    );
  });

  test("a consumer's icons, falling back to Carbon's", async () => {
    const { code } = await compileMarkdown(
      '```astro title="Page.astro"\nx\n```\n\n```js title="a.js"\nx\n```',
      {
        prose: false,
        codeIcons: (target) =>
          target.type === "file" && target.title?.endsWith(".astro")
            ? { name: "Astro", from: "/src/icons/Astro.svelte" }
            : carbonCodeIcon(target),
      },
    );
    expect(code).toContain('import MdAstro from "/src/icons/Astro.svelte";');
    expect(code).toContain(
      'import MdScript from "carbon-icons-svelte/lib/Script.svelte";',
    );
  });

  test("a status alone, without a file name", async () => {
    const { html } = await renderMarkdown(
      '```js kind="warning" label="Deprecated"\nx\n```',
    );
    expect(html).toContain(
      '<div class="code-block" data-kind="warning">\n<div class="code-block__header"><span class="code-block__status">Deprecated</span></div>',
    );
  });

  test("`iconOnly`: the icon, with the name for screen readers and as a tooltip", async () => {
    const { code } = await compileMarkdown("```svelte iconOnly\n<p />\n```", {
      prose: false,
      codeIcons: carbonCodeIcon,
    });
    expect(code).toContain(
      '<div class="code-block__header"><span class="code-block__icon-only" title="svelte"><MdLogoSvelte class="code-block__icon" /><span class="bx--assistive-text">svelte</span></span></div>',
    );
  });

  test("without a header, a theme and variant go on the block", async () => {
    const { html } = await renderMarkdown(
      '```js theme="g90" variant="compact"\nx\n```',
    );
    expect(html).toContain(
      '<pre class="language-js" data-variant="compact" theme="g90">',
    );
  });

  test("CodeSnippet hides its copy button for `dont` blocks", async () => {
    const { html } = await renderMarkdown("```js dont\nx\n```", {
      codeSnippet: true,
    });
    expect(html).toContain(
      '<CodeSnippet type="multi" code={"x"} hideCopyButton>',
    );
  });

  test("`::: compare` groups blocks side by side", async () => {
    const { html } = await renderMarkdown(
      "::: compare\n```js dont\na\n```\n```js do\nb\n```\n:::",
    );
    expect(
      html.startsWith(
        '<div class="code-compare">\n<div class="code-block" data-kind="error">',
      ),
    ).toBe(true);
    expect(html).toContain('<div class="code-block" data-kind="success">');
  });
});

describe("collapsible sections", () => {
  test("`collapse` ranges merge and sort", () => {
    expect(parseCodeMeta("collapse={8-9,1-3,3-4}").collapse).toEqual([
      [1, 4],
      [8, 9],
    ]);
  });

  test("fold lines into a <details> row that opens without JavaScript; copy keeps them", async () => {
    const lines = await renderCodeLines("a\nb\nc\nd\n", "js", "collapse={2-3}");
    expect(lines?.html).toBe(
      '<span class="line">a</span><details class="code-fold" style="--lines: 2"><summary class="code-fold__summary" data-count="2 lines"><span class="bx--assistive-text">2 lines</span></summary><span class="line">b</span>\n<span class="line">c</span></details><span class="line">d</span>',
    );
    expect(lines?.copy).toBe("a\nb\nc\nd");
  });
});

describe("diffs", () => {
  test("`+` and `-` lines become inserted and deleted, the sign column goes, headers stay plain", async () => {
    const source =
      '@@ -1,3 +1,3 @@\n import { Button } from "x";\n-<Button>Old</Button>\n+<Button>New</Button>';
    const fence = prepareFence(source, "diff-svelte", "");
    expect(fence.lang).toBe("svelte");
    expect(fence.code).toBe(
      '@@ -1,3 +1,3 @@\nimport { Button } from "x";\n<Button>Old</Button>\n<Button>New</Button>',
    );
    expect([...fence.plain]).toEqual([1]);
    expect(
      Object.fromEntries(
        [...fence.meta.marks].map(([line, set]) => [line, [...set]]),
      ),
    ).toEqual({ 3: ["del"], 4: ["ins"] });

    const lines = await renderCodeLines(
      source,
      "diff-svelte",
      "",
      (code, lang) => `[${lang}]${code}`,
    );
    expect(lines?.html.split("\n")[0]).toBe(
      '<span class="line" data-diff-header>@@ -1,3 +1,3 @@</span>',
    );
    expect(lines?.copy).toBe(
      'import { Button } from "x";\n<Button>New</Button>',
    );
  });

  test("`diff` in the metadata diffs the fence's own language; plain ```diff has nothing to highlight", () => {
    expect(prepareFence("+a", "js", "diff")).toMatchObject({
      lang: "js",
      code: "a",
    });
    expect(prepareFence("+a", "diff", "")).toMatchObject({
      lang: "",
      code: "a",
    });
  });
});

describe("::: code-group group", () => {
  test("names a group whose tabs sync by label", async () => {
    const { html } = await renderMarkdown(
      '::: code-group group="svelte"\n```svelte [Svelte 5]\na\n```\n:::',
    );
    expect(
      html.startsWith('<div class="code-group" data-group="svelte">'),
    ).toBe(true);
  });
});
