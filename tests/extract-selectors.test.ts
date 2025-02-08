import { describe, expect, test } from "bun:test";
import { extractSelectors } from "../scripts/extract-selectors";

describe("extractSelectors", () => {
  test("extracts single class from class attribute", () => {
    const result = extractSelectors({
      code: '<div class="test-class"></div>',
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".test-class"]);
    expect(result.components).toEqual([]);
  });

  test("extracts multiple classes from class attribute", () => {
    const result = extractSelectors({
      code: '<div class="class1 class2 class3"></div>',
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".class1", ".class2", ".class3"]);
    expect(result.components).toEqual([]);
  });

  test("extracts Carbon classes with bx-- prefix", () => {
    const result = extractSelectors({
      code: '<div class="bx--btn bx--modal"></div>',
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".bx--btn", ".bx--modal"]);
  });

  test("extracts class directives", () => {
    const result = extractSelectors({
      code: "<div class:active={isActive} class:bx--selected={isSelected}></div>",
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".active", ".bx--selected"]);
  });

  test("extracts classes from dynamic expressions", () => {
    const result = extractSelectors({
      code: "<div class=\"{dynamic} static-class {condition ? 'bx--active' : ''}\"></div>",
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".static-class", ".bx--active"]);
  });

  test("extracts global selectors", () => {
    const result = extractSelectors({
      code: "<style>:global(.bx--global-class) { color: red; }</style>",
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".bx--global-class"]);
  });

  test("extracts component references", () => {
    const result = extractSelectors({
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
    const result = extractSelectors({
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

  test("deduplicates classes and components", () => {
    const result = extractSelectors({
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
    const result = extractSelectors({
      code: '<div class="   "></div>',
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([]);
  });
});
