import { diffComponentIndex } from "../scripts/diff-component-index";

const button = {
  path: "carbon-components-svelte/src/Button/Button.svelte",
  classes: [".bx--btn", ".bx--btn--primary"],
};

describe("diffComponentIndex", () => {
  test("returns nothing for identical indexes", () => {
    expect(diffComponentIndex({ Button: button }, { Button: button })).toEqual(
      [],
    );
  });

  test("reports added, removed, moved, and reclassed components", () => {
    const before = {
      Button: button,
      Old: { path: "carbon-components-svelte/src/Old/Old.svelte", classes: [] },
      Tag: { path: "carbon-components-svelte/src/Tag/Tag.svelte", classes: [] },
    };
    const after = {
      Button: {
        path: button.path,
        classes: [".bx--btn", ".bx--btn--ghost"],
      },
      New: {
        path: "carbon-components-svelte/src/New/New.svelte",
        classes: [".bx--new"],
      },
      Tag: {
        path: "carbon-components-svelte/src/Tags/Tag.svelte",
        classes: [],
      },
    };

    expect(diffComponentIndex(before, after)).toEqual([
      "~ Button",
      "    + .bx--btn--ghost",
      "    - .bx--btn--primary",
      "+ New (carbon-components-svelte/src/New/New.svelte, 1 classes)",
      "- Old (carbon-components-svelte/src/Old/Old.svelte, 0 classes)",
      "~ Tag",
      "    path: carbon-components-svelte/src/Tag/Tag.svelte -> carbon-components-svelte/src/Tags/Tag.svelte",
      "4 components changed: +2 -1 classes",
    ]);
  });
});
