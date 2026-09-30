import {
  createModulePropScanner,
  createPropScanner,
  createPropUsage,
  mergePropUsage,
  type PropUsage,
  variantProps,
} from "carbon-preprocess-svelte/plugins/scan-props";

const scan = createPropScanner(["kind", "tooltipPosition"]);

function usage(...sources: string[]): PropUsage {
  const into = createPropUsage();
  for (const source of sources) scan?.(source, into);
  return into;
}

function literals(into: PropUsage, prop: string): string[] {
  return [...(into.literals.get(prop) ?? [])].sort();
}

describe("createPropScanner", () => {
  test("returns undefined with no props to scan for", () => {
    expect(createPropScanner([])).toBeUndefined();
  });

  test.each([
    ["Svelte 5 compiled props", `Button(node, { kind: 'ghost' });`],
    ["Svelte 4 compiled props", `props: { kind: "ghost", $$slots }`],
    ["object literal", `const props = { kind: "ghost" };`],
    ["JSON module", `export default { "kind": "ghost" }`],
    ["member assignment", `props.kind = "ghost";`],
    ["markup attribute", `<Button kind="ghost" size="sm">`],
    ["braced markup attribute", `<Button kind={"ghost"} />`],
    ["template literal", "const props = { kind: `ghost` };"],
    ["computed key", `const props = { ["kind"]: "ghost" };`],
    ["computed assignment", `props["kind"] = "ghost";`],
  ])("reads a literal value from %s", (_, source) => {
    const into = usage(source);
    expect(literals(into, "kind")).toEqual(["ghost"]);
    expect(into.dynamic.size).toBe(0);
  });

  test.each([
    ["a variable", `Button(node, { kind: k });`],
    ["an expression", `props: { kind: danger ? "danger" : "primary" }`],
    ["a concatenation", `const props = { kind: "danger" + suffix };`],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source under test is a template literal
    ["a template substitution", "const props = { kind: `danger-${x}` };"],
    ["object shorthand", `Button(node, { kind });`],
    ["a trailing shorthand", `Button(node, { size, kind })`],
    ["a Svelte 5 getter", `{ get kind() { return $.get(k); } }`],
    ["a Svelte 5 prop read", `let kind = $.prop($$props, "kind", 3, "ghost");`],
    ["a member assignment", `button_changes.kind = /*k*/ ctx[0];`],
    ["an escaped string", `const props = { kind: "gh\\u006fst" };`],
    ["a value that is not one class", `const props = { kind: "a b" };`],
    ["an empty string", `const props = { kind: "" };`],
    [
      "a key inside a stringified JSON module",
      String.raw`export default JSON.parse("{\"kind\":\"ghost\"}")`,
    ],
  ])("marks the prop dynamic for %s", (_, source) => {
    const into = usage(source);
    expect(into.dynamic).toEqual(new Set(["kind"]));
    expect(into.literals.has("kind")).toBe(false);
  });

  test.each([
    ["a member read", `if (node.kind === "x") {}`],
    ["an optional member read", "const k = node?.kind;"],
    ["prose in a comment", "// needs some kind of handling"],
    ["prose in a string", `throw new Error("an unknown kind of thing");`],
    ["a longer identifier", "const kindness = 1; const tooltipPositions = [];"],
    ["a comparison", "if (kind == x || kind === y) {}"],
    ["the name as a string value", `Button(node, { variant: "kind" });`],
    ["the name as a call argument", `$.prop($$props, "kind", 3);`],
    [
      "an escaped string value",
      String.raw`JSON.parse("{\"variant\":\"kind\"}")`,
    ],
  ])("ignores %s", (_, source) => {
    const into = usage(source);
    expect(into.dynamic.size).toBe(0);
    expect(into.literals.size).toBe(0);
  });

  test("collects every literal across modules", () => {
    const into = usage(
      `Button(a, { kind: "danger" });`,
      `Button(b, { kind: "secondary", tooltipPosition: "top" });`,
    );
    expect(literals(into, "kind")).toEqual(["danger", "secondary"]);
    expect(literals(into, "tooltipPosition")).toEqual(["top"]);
  });

  test("one dynamic use wins over literals seen before or after", () => {
    const into = usage(
      `Button(a, { kind: "danger" });`,
      `Button(b, { kind: k });`,
      `Button(c, { kind: "ghost" });`,
    );
    expect(into.dynamic).toEqual(new Set(["kind"]));
    expect(into.literals.has("kind")).toBe(false);
  });
});

test.each([
  ["true", "Tag(node, { filter: true });"],
  ["false", "Tag(node, { filter: false })"],
  ["true", "<Tag filter={true} />"],
])("reads the boolean %s", (value, source) => {
  const into = createPropUsage();
  createPropScanner(["filter"])?.(source, into);
  expect(into.literals.get("filter")).toEqual(new Set([value]));
});

test("an identifier starting with true is not a boolean", () => {
  const into = createPropUsage();
  createPropScanner(["filter"])?.("Tag(node, { filter: trueish });", into);
  expect(into.dynamic).toEqual(new Set(["filter"]));
});

describe("mergePropUsage", () => {
  test("unions literals and dynamic props", () => {
    const into = usage(`Button(a, { kind: "danger" });`);
    mergePropUsage(
      into,
      usage(`Button(b, { kind: "ghost", tooltipPosition: p });`),
    );

    expect(literals(into, "kind")).toEqual(["danger", "ghost"]);
    expect(into.dynamic).toEqual(new Set(["tooltipPosition"]));
  });
});

describe("variantProps", () => {
  test("collects the props every component's variants name", () => {
    expect(
      variantProps({
        Button: {
          path: "Button.svelte",
          classes: [".bx--btn--"],
          variants: [
            { prefix: ".bx--btn--", prop: "kind", default: "primary" },
          ],
        },
        Link: { path: "Link.svelte", classes: [".bx--link"] },
      }),
    ).toEqual(new Set(["kind"]));
  });
});

describe("createModulePropScanner", () => {
  const components = {
    Button: {
      path: "carbon-components-svelte/src/Button/Button.svelte",
      classes: [".bx--btn--"],
      variants: [{ prefix: ".bx--btn--", prop: "kind", default: "primary" }],
    },
  };
  const carbonSrc = "/app/node_modules/carbon-components-svelte/src/";
  const scanModule = createModulePropScanner(components, carbonSrc);
  const code = 'Button(node, { kind: "danger" });';

  test("reads app modules", () => {
    expect(scanModule?.("/app/src/App.svelte", code)?.literals).toEqual(
      new Map([["kind", new Set(["danger"])]]),
    );
  });

  test.each([
    [
      "a path inside a folder named after Carbon",
      "/work/carbon-components-svelte/docs/src/Page.svelte",
    ],
    ["a virtual module", "\0virtual:buttons"],
    ["a Windows path", "C:\\app\\src\\App.svelte"],
  ])("reads %s", (_, id) => {
    expect(scanModule?.(id, code)).toBeDefined();
  });

  test.each([
    ["Carbon's own sources", `${carbonSrc}Button/Button.svelte`],
    ["a stylesheet", "/app/src/app.css"],
    [
      "Svelte's runtime",
      "/app/node_modules/svelte/src/internal/client/index.js",
    ],
    [
      "SvelteKit's runtime",
      "/app/node_modules/.pnpm/@sveltejs+kit@2/node_modules/@sveltejs/kit/src/runtime/client.js",
    ],
    [
      "a Svelte style sub-module",
      "/app/src/App.svelte?svelte&type=style&lang.css",
    ],
  ])("skips %s", (_, id) => {
    expect(scanModule?.(id, code)).toBeUndefined();
  });

  test("reads Carbon's own sources when Carbon can't be located", () => {
    const scanAll = createModulePropScanner(components, undefined);
    expect(
      scanAll?.(
        `${carbonSrc}Button/Button.svelte`,
        'let kind = $.prop($$props, "kind");',
      )?.dynamic,
    ).toEqual(new Set(["kind"]));
  });

  test("a scan that throws marks every prop dynamic", () => {
    expect(
      scanModule?.("/app/src/App.svelte", null as unknown as string)?.dynamic,
    ).toEqual(new Set(["kind"]));
  });

  test("nothing to record returns undefined", () => {
    expect(
      scanModule?.("/app/src/util.js", "export const x = 1;"),
    ).toBeUndefined();
  });

  test("undefined when the index has no variants", () => {
    expect(
      createModulePropScanner({ Link: { path: "a", classes: [] } }, carbonSrc),
    ).toBeUndefined();
  });
});
