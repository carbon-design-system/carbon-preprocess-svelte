import { parse } from "svelte/compiler";
import { extractFromSvelte } from "../src/indexer/extract-selectors";

const extract = (props: { code: string; filename: string }) =>
  extractFromSvelte({ ...props, parse });

describe("extractFromSvelte", () => {
  test("extracts single class from class attribute", () => {
    const result = extract({
      code: '<div class="test-class"></div>',
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".test-class"]);
    expect(result.components).toEqual([]);
  });

  test("extracts multiple classes from class attribute", () => {
    const result = extract({
      code: '<div class="class1 class2 class3"></div>',
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".class1", ".class2", ".class3"]);
    expect(result.components).toEqual([]);
  });

  test("extracts Carbon classes with bx-- prefix", () => {
    const result = extract({
      code: '<div class="bx--btn bx--modal"></div>',
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".bx--btn", ".bx--modal"]);
  });

  test("extracts class directives", () => {
    const result = extract({
      code: "<div class:active={isActive} class:bx--selected={isSelected}></div>",
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".active", ".bx--selected"]);
  });

  test("extracts classes from dynamic expressions", () => {
    const result = extract({
      code: "<div class=\"{dynamic} static-class {condition ? 'bx--active' : ''}\"></div>",
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".static-class", ".bx--active"]);
  });

  test("extracts global selectors", () => {
    const result = extract({
      code: "<style>:global(.bx--global-class) { color: red; }</style>",
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".bx--global-class"]);
  });

  test("extracts component references", () => {
    const result = extract({
      code: `
        <script>
          import { Button, Modal } from 'carbon-components-svelte';
        </script>
        <Button />
        <Modal />
        <svelte:component this={DynamicComponent} />
      `,
      filename: "test.svelte",
    });
    expect(result.components).toEqual(["Button", "Modal", "DynamicComponent"]);
  });

  test("handles template literals with Carbon classes", () => {
    const result = extract({
      code: `
        <script>
          const className = \`bx--template-class\`;
        </script>
        <div class={className}></div>
      `,
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".bx--template-class"]);
  });

  test("string literals naming several classes add each one", () => {
    const result = extract({
      code: `
        <script>
          const both = "bx--tooltip__trigger bx--tooltip--a11y";
          const selector = ".bx--tree-node:not(.bx--tree-node--hidden)";
          const markup = '<strong class="bx--highlight">';
          const prefixed = "bx--aspect-ratio bx--aspect-ratio--" + ratio;
          const mixed = \`bx--a \${x ? "bx--b" : ""} bx--c--\${size}\`;
          const unrelated = "not-carbon bx-single-hyphen";
          const pattern = /^bx--(overflow-menu|checkbox)/;
        </script>
      `,
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([
      ".bx--tooltip__trigger",
      ".bx--tooltip--a11y",
      ".bx--tree-node",
      ".bx--tree-node--hidden",
      ".bx--highlight",
      ".bx--aspect-ratio",
      ".bx--aspect-ratio--",
      // The walk visits a template's expressions before its quasis.
      ".bx--b",
      ".bx--a",
      ".bx--c--",
    ]);
  });

  test.each([['context="module"'], ["module"]])(
    "module script (<script %s>) literals are importable classes",
    (attr) => {
      const result = extract({
        code: `
        <script ${attr}>
          export const SIZES = { sm: "bx--foo--sm", lg: "bx--foo--lg" };
          export const variant = (kind) => \`bx--foo--\${kind}\`;
          export const inModal = (el) => el.closest(".bx--modal");
        </script>
        <script>
          const local = "bx--instance-only";
        </script>
        <div class={SIZES.sm}></div>
      `,
        filename: "test.svelte",
      });
      expect(result.moduleClasses).toEqual([
        ".bx--foo--sm",
        ".bx--foo--lg",
        ".bx--foo--",
      ]);
      // The component itself still gets all of them, lookups included.
      expect(result.classes).toEqual(
        expect.arrayContaining([
          ".bx--foo--sm",
          ".bx--modal",
          ".bx--instance-only",
        ]),
      );
    },
  );

  test("deduplicates classes and components", () => {
    const result = extract({
      code: `
        <div class="duplicate duplicate bx--duplicate bx--duplicate"></div>
        <Button />
        <Button />
      `,
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".duplicate", ".bx--duplicate"]);
    expect(result.components).toEqual(["Button"]);
  });

  test("handles empty and whitespace-only classes", () => {
    const result = extract({
      code: '<div class="   "></div>',
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([]);
  });
});

describe("extractFromSvelte variants", () => {
  const variants = (code: string) =>
    extract({ code, filename: "test.svelte" }).variants;

  test("a prefix completed only by an exported prop with a literal default", () => {
    expect(
      variants(`
        <script>
          export let kind = "primary";
          export let size = "md";
        </script>
        <button class={[kind && \`bx--btn--\${kind}\`, \`bx--size--\${size}\`]}></button>
      `),
    ).toEqual([
      { prefix: ".bx--btn--", prop: "kind", default: "primary" },
      { prefix: ".bx--size--", prop: "size", default: "md" },
    ]);
  });

  test.each([
    [
      "the prop has no literal default",
      `<script>export let kind = undefined;</script>
       <div class={\`bx--btn--\${kind}\`}></div>`,
    ],
    [
      "the variable is not a prop",
      `<script>let kind = "primary";</script>
       <div class={\`bx--btn--\${kind}\`}></div>`,
    ],
    [
      "the component reassigns the prop",
      `<script>export let kind = "primary"; $: if (x) kind = "ghost";</script>
       <div class={\`bx--btn--\${kind}\`}></div>`,
    ],
    [
      "the prop is bound",
      `<script>export let kind = "primary";</script>
       <Select bind:selected={kind} />
       <div class={\`bx--btn--\${kind}\`}></div>`,
    ],
    [
      "a function parameter shadows the prop",
      `<script>
         export let kind = "primary";
         const cls = (kind) => \`bx--btn--\${kind}\`;
       </script>`,
    ],
    [
      "an each block shadows the prop",
      `<script>export let kind = "primary";</script>
       {#each kinds as kind}<div class={\`bx--btn--\${kind}\`}></div>{/each}`,
    ],
    [
      "another literal names the same prefix",
      `<script>export let kind = "primary";</script>
       <div class={\`bx--btn--\${kind}\`}></div>
       <div class="bx--btn--{size}"></div>`,
    ],
    [
      "two props complete the same prefix",
      `<script>export let kind = "primary"; export let size = "md";</script>
       <div class={[\`bx--btn--\${kind}\`, \`bx--btn--\${size}\`]}></div>`,
    ],
    [
      "the template is longer than prefix + prop",
      `<script>export let kind = "primary";</script>
       <div class={\`bx--btn--\${kind}--sm\`}></div>`,
    ],
    [
      "the template is in the module script",
      `<script context="module">export const cls = (kind) => \`bx--btn--\${kind}\`;</script>
       <script>export let kind = "primary";</script>`,
    ],
  ])("none when %s", (_, code) => {
    expect(variants(code)).toEqual([]);
  });
});

describe("extractFromSvelte gates", () => {
  const gates = (code: string) =>
    extract({ code, filename: "test.svelte" }).gates;

  test("class directives on a boolean or compared prop", () => {
    expect(
      gates(`
        <script>
          export let filter = false;
          export let size = "md";
          export let type = undefined;
        </script>
        <div
          class:bx--tag--filter={filter}
          class:bx--tag--sm={size === "sm"}
          class:bx--tag--red={"red" === type}
        ></div>
      `),
    ).toEqual([
      {
        class: ".bx--tag--filter",
        when: [[{ prop: "filter", default: false }]],
      },
      {
        class: ".bx--tag--sm",
        when: [[{ prop: "size", default: "md", equals: "sm" }]],
      },
      {
        class: ".bx--tag--red",
        when: [[{ prop: "type", default: null, equals: "red" }]],
      },
    ]);
  });

  test("non-Carbon classes are never gates", () => {
    expect(
      gates(`<script>export let active = false;</script>
        <div class:active></div>`),
    ).toEqual([]);
  });

  test("&& chains and ternaries, keeping only prop conditions", () => {
    expect(
      gates(`
        <script>
          export let inline = false;
          export let size = "md";
          let open = false;
        </script>
        <div class={[
          inline && size === "sm" && "bx--label--inline--sm",
          open && inline && "bx--label--open",
          size === "xl" ? "bx--label--xl" : "bx--label--other",
        ]}></div>
      `),
    ).toEqual([
      {
        class: ".bx--label--inline--sm",
        when: [
          [
            { prop: "inline", default: false },
            { prop: "size", default: "md", equals: "sm" },
          ],
        ],
      },
      {
        class: ".bx--label--open",
        when: [[{ prop: "inline", default: false }]],
      },
      {
        class: ".bx--label--xl",
        when: [[{ prop: "size", default: "md", equals: "xl" }]],
      },
    ]);
  });

  test("one entry per place a class is rendered", () => {
    expect(
      gates(`
        <script>export let a = false; export let b = false;</script>
        <div class:bx--x={a}></div><div class:bx--x={b}></div><div class:bx--x={a}></div>
      `),
    ).toEqual([
      {
        class: ".bx--x",
        when: [
          [{ prop: "a", default: false }],
          [{ prop: "b", default: false }],
        ],
      },
    ]);
  });

  test.each([
    [
      "the class is also rendered unconditionally",
      `<script>export let filter = false;</script>
       <div class:bx--tag--filter={filter}></div><span class="bx--tag--filter"></span>`,
    ],
    [
      "the condition is component state",
      `<script>let open = false;</script><div class:bx--x--open={open}></div>`,
    ],
    [
      "the prop is reassigned",
      `<script>export let open = false; const toggle = () => (open = !open);</script>
       <div class:bx--x--open={open}></div>`,
    ],
    [
      "the prop has a non-literal default",
      `<script>export let size = defaultSize();</script>
       <div class:bx--x--sm={size === "sm"}></div>`,
    ],
    [
      "the condition is a negation",
      `<script>export let hidden = false;</script><div class:bx--x--shown={!hidden}></div>`,
    ],
    [
      "the class is the else branch",
      `<script>export let a = false;</script><div class={a ? "" : "bx--x"}></div>`,
    ],
    [
      "the condition is in the module script",
      `<script context="module">export const cls = (a) => a && "bx--x";</script>
       <script>export let a = false;</script>`,
    ],
  ])("none when %s", (_, code) => {
    expect(gates(code)).toEqual([]);
  });
});
