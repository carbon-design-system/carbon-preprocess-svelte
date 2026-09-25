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
