import { components } from "carbon-preprocess-svelte/component-index";
import {
  decodeComponentIndex,
  encodeComponentIndex,
} from "carbon-preprocess-svelte/component-index/codec";
import { buildComponentIndex } from "carbon-preprocess-svelte/indexer/build-index";

describe("component index codec", () => {
  test("round-trips a hand-written index", () => {
    const index = {
      Button: {
        path: "carbon-components-svelte/src/Button/Button.svelte",
        classes: [".bx--btn", ".bx--btn__icon", ".bx--btn--primary"],
      },
      ButtonSkeleton: {
        path: "carbon-components-svelte/src/Button/ButtonSkeleton.svelte",
        classes: [".bx--btn", ".bx--skeleton"],
      },
      toCsv: {
        path: "carbon-components-svelte/src/DataTable/data-table-utils.js",
        classes: [],
      },
      truncate: {
        path: "carbon-components-svelte/src/Truncate/truncate.js",
        classes: [],
      },
      TreeView: {
        path: "carbon-components-svelte/src/TreeView/TreeView.svelte",
        classes: [
          '.[role="treeitem"]:not(.bx--tree-node--hidden)',
          ".bx--tree-node--hidden",
          ".ul.bx--tree-node--hidden",
        ],
      },
    };

    expect(decodeComponentIndex(encodeComponentIndex(index))).toEqual(index);
  });

  test("encodes gaps wider than one VLQ digit", () => {
    const classes = Array.from({ length: 2000 }, (_, i) => `.bx--c${i}`).sort(
      (a, b) => a.localeCompare(b),
    );
    const index = {
      Wide: {
        path: "carbon-components-svelte/src/Wide/Wide.svelte",
        classes: [classes[0], classes[1999]],
      },
      All: { path: "carbon-components-svelte/src/All/All.svelte", classes },
    };

    expect(decodeComponentIndex(encodeComponentIndex(index))).toEqual(index);
  });

  test("rejects a path outside carbon-components-svelte/src", () => {
    expect(() =>
      encodeComponentIndex({
        X: { path: "somewhere/else/X.svelte", classes: [] },
      }),
    ).toThrow();
  });

  test("checked-in index matches a fresh build", async () => {
    const fresh = await buildComponentIndex();
    expect(components).toEqual(fresh);
  });
});
