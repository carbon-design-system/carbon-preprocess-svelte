import { highlight, tokenize } from "carbon-preprocess-svelte";
import { exampleSource } from "carbon-preprocess-svelte/markdown/example";

const types = (code: string, lang: string) =>
  tokenize(code, lang)
    ?.filter((token) => token.type)
    .map((token) => `${token.type}:${token.text}`);

describe("tokenize", () => {
  test("classifies script tokens by Carbon's syntax token names", () => {
    expect(
      types(
        'import { a } from "x";\nconst n = 1; // c\nif (b) f(/x/g, this.p);',
        "js",
      ),
    ).toEqual([
      "moduleKeyword:import",
      "brace:{",
      "brace:}",
      "moduleKeyword:from",
      'string:"x"',
      "punctuation:;",
      "definitionKeyword:const",
      "definition:n",
      "operator:=",
      "number:1",
      "punctuation:;",
      "comment:// c",
      "controlKeyword:if",
      "paren:(",
      "paren:)",
      "function:f",
      "paren:(",
      "regexp:/x/g",
      "punctuation:,",
      "self:this",
      "punctuation:.",
      "propertyName:p",
      "paren:)",
      "punctuation:;",
    ]);
  });

  test("tokenizes Svelte markup, expressions, and the script and style inside", () => {
    expect(
      types(
        "<script>let a;</script><B on:click={() => a++}>{#if a}x{/if}</B><style>p { color: #fff }</style>",
        "svelte",
      ),
    ).toEqual([
      "angleBracket:<",
      "tagName:script",
      "angleBracket:>",
      "definitionKeyword:let",
      "definition:a",
      "punctuation:;",
      "angleBracket:</",
      "tagName:script",
      "angleBracket:>",
      "angleBracket:<",
      "tagName:B",
      "attributeName:on:click",
      "operator:=",
      "brace:{",
      "paren:(",
      "paren:)",
      "operator:=>",
      "operator:++",
      "brace:}",
      "angleBracket:>",
      "brace:{",
      "controlKeyword:#if",
      "brace:}",
      "brace:{",
      "controlKeyword:/if",
      "brace:}",
      "angleBracket:</",
      "tagName:B",
      "angleBracket:>",
      "angleBracket:<",
      "tagName:style",
      "angleBracket:>",
      "tagName:p",
      "brace:{",
      "propertyName:color",
      "punctuation::",
      "color:#fff",
      "brace:}",
      "angleBracket:</",
      "tagName:style",
      "angleBracket:>",
    ]);
  });

  test("tokenizes CSS, JSON, shell, and diffs", () => {
    expect(types("a { margin: 1.5rem }", "css")).toEqual([
      "tagName:a",
      "brace:{",
      "propertyName:margin",
      "punctuation::",
      "number:1.5",
      "unit:rem",
      "brace:}",
    ]);
    expect(types('{"a": [1, true, null]}', "json")).toContain(
      'propertyName:"a"',
    );
    expect(types("bun add -d pkg # dev", "sh")).toEqual([
      "function:bun",
      "attributeName:-d",
      "comment:# dev",
    ]);
    expect(types("-old\n+new", "diff")).toEqual([
      "deleted:-old\n",
      "inserted:+new",
    ]);
  });

  test("reads expressions inside quoted attribute values as script", () => {
    expect(types('<B on:click="{() => log("x")}" />', "svelte")).toEqual([
      "angleBracket:<",
      "tagName:B",
      "attributeName:on:click",
      "operator:=",
      'attributeValue:"',
      "brace:{",
      "paren:(",
      "paren:)",
      "operator:=>",
      "function:log",
      "paren:(",
      'string:"x"',
      "paren:)",
      "brace:}",
      'attributeValue:"',
      "angleBracket:/>",
    ]);
  });

  test("colors TypeScript's built-in types in type positions", () => {
    expect(types("function f(role: string): Promise<void> {}", "ts")).toContain(
      "typeName:string",
    );
    expect(types("let n: number | undefined;", "ts")).toContain(
      "typeName:number",
    );
    expect(types("const o = { number };", "js")).not.toContain(
      "typeName:number",
    );
  });

  test("keeps every character, so offsets map back to the source", () => {
    const code = '<A b="c" {d}>{#each e as f}{f}{/each}</A>\n<!-- g -->';
    expect(
      tokenize(code, "svelte")
        ?.map((token) => token.text)
        .join(""),
    ).toBe(code);
  });

  test("returns undefined for an unknown language", () => {
    expect(tokenize("x", "cobol")).toBeUndefined();
    expect(highlight("x", "cobol")).toBeUndefined();
  });

  test("renders spans with escaped text", () => {
    expect(highlight("a < {b}", "js")).toBe(
      'a <span class="tok-operator">&lt;</span> <span class="tok-brace">&#123;</span>b<span class="tok-brace">&#125;</span>',
    );
  });
});

describe("exampleSource", () => {
  const page = `<script>
  import { Button, ImageLoader, Stack } from "carbon-components-svelte";
  import Add from "carbon-icons-svelte/lib/Add.svelte";

  let key = 0;
  const regions = ["a", "b"];
  const items = regions.map((region) => ({
    id: region,
  }));
  let unused = 1;
  function reload() {
    key++;
  }
</script>`;

  test("adds the imports and declarations the example uses, transitively", () => {
    expect(
      exampleSource(
        "<Button icon={Add} on:click={reload}>{items.length}</Button>",
        page,
      ),
    ).toBe(`<script>
  import { Button } from "carbon-components-svelte";
  import Add from "carbon-icons-svelte/lib/Add.svelte";

  let key = 0;
  const regions = ["a", "b"];
  const items = regions.map((region) => ({
    id: region,
  }));
  function reload() {
    key++;
  }
</script>

<Button icon={Add} on:click={reload}>{items.length}</Button>`);
  });

  test("follows bind: and class: shorthands, and ignores names in text", () => {
    const source = exampleSource(
      "<ImageLoader bind:key class:unused>regions</ImageLoader>",
      page,
    );
    expect(source).toContain("import { ImageLoader }");
    expect(source).toContain("let key = 0;");
    expect(source).toContain("let unused = 1;");
    expect(source).not.toContain("const regions");
  });

  test("keeps the page's blank lines between the statements it includes", () => {
    const spaced = `<script>
  import { Button } from "carbon-components-svelte";

  let count = 0;
  let step = 1;

  function add() {
    count += step;
  }
</script>`;
    expect(
      exampleSource("<Button on:click={add}>{count}</Button>", spaced),
    ).toBe(`<script>
  import { Button } from "carbon-components-svelte";

  let count = 0;
  let step = 1;

  function add() {
    count += step;
  }
</script>

<Button on:click={add}>{count}</Button>`);
  });

  test("follows names used inside template literals", () => {
    const markup = ["<p>{`Total: $", "{items.length}`}</p>"].join("");
    const source = exampleSource(markup, page);
    expect(source).toContain("const items = regions.map");
    expect(source).toContain('const regions = ["a", "b"];');
  });

  test("returns the markup alone when the example needs nothing from the page", () => {
    expect(exampleSource("<p>Hi</p>", page)).toBe("<p>Hi</p>");
    expect(exampleSource("<Button />", undefined)).toBe("<Button />");
  });
});
