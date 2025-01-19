import { extractSelectors } from "../scripts/extract-selectors";

describe("extractSelectors", () => {
  test("extracts single class from class attribute", () => {
    const result = extractSelectors({
      code: '<div class="test-class"></div>',
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".test-class"]);
  });

  test("extracts multiple classes from class attribute", () => {
    const result = extractSelectors({
      code: '<div class="class1 class2 class3"></div>',
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".class1", ".class2", ".class3"]);
  });

  test("extracts class directives", () => {
    const result = extractSelectors({
      code: "<div class:active={isActive}></div>",
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".active"]);
  });

  test("extracts global selectors", () => {
    const result = extractSelectors({
      code: "<style>:global(div) { color: red; }</style>",
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".div"]);
  });

  test("handles Carbon prefix classes", () => {
    const result = extractSelectors({
      code: '<div class="bx--button bx--text"></div>',
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".bx--button", ".bx--text"]);
  });

  test("deduplicates repeated classes", () => {
    const result = extractSelectors({
      code: '<div class="test test test"></div>',
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([".test"]);
  });

  test("handles mixed scenarios", () => {
    const result = extractSelectors({
      code: `
        <div class="regular-class bx--carbon-class">
          <span class:active={isActive}></span>
          <style>:global(body) { margin: 0; }</style>
        </div>
      `,
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([
      ".regular-class",
      ".bx--carbon-class",
      ".active",
    ]);
  });

  test("handles empty class attributes", () => {
    const result = extractSelectors({
      code: '<div class=""></div>',
      filename: "test.svelte",
    });
    expect(result.classes).toEqual([]);
  });

  test("handles inline components", () => {
    const result = extractSelectors({
      code: "<div><Test /><Component /></div>",
      filename: "test.svelte",
    });
    expect(result.components).toEqual(["Test", "Component"]);
  });
});
