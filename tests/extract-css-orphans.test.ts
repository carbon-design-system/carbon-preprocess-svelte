import { extractCssOrphans } from "../src/indexer/extract-css-context";

const owned = (entries: Record<string, string[]>) =>
  new Map(
    Object.entries(entries).map(([name, classes]) => [name, new Set(classes)]),
  );

describe("extractCssOrphans", () => {
  test("credits a CSS-only class to the component that renders its family", () => {
    // `--sm` is an alias only the CSS names; `Toolbar` renders the block.
    const orphans = extractCssOrphans({
      componentClasses: owned({
        Toolbar: [".bx--table-toolbar", ".bx--table-toolbar--small"],
        Button: [".bx--btn"],
      }),
      css: ".bx--table-toolbar--sm .bx--btn{padding:0}",
    });
    expect([...(orphans.get("Toolbar") ?? [])]).toEqual([
      ".bx--table-toolbar--sm",
    ]);
    expect(orphans.has("Button")).toBe(false);
  });

  test("a prefix the component renders counts as its family", () => {
    const orphans = extractCssOrphans({
      componentClasses: owned({
        Tag: [".bx--tag", ".bx--tag--"],
        Button: [".bx--btn"],
      }),
      css: ".bx--btn .bx--tag--magenta-x{color:red}",
    });
    expect([...(orphans.get("Tag") ?? [])]).toEqual([".bx--tag--magenta-x"]);
    expect(orphans.has("Button")).toBe(false);
  });

  test("without a family, the components that share the selector", () => {
    const orphans = extractCssOrphans({
      componentClasses: owned({ Button: [".bx--btn"] }),
      css: ".bx--btn .bx--assistive-text{display:none}",
    });
    expect([...(orphans.get("Button") ?? [])]).toEqual([".bx--assistive-text"]);
  });
});
