import { buildComponentIndex } from "../src/indexer/build-index";
import { createFakeCarbonPackage } from "./helpers/fake-carbon-package";
import { resolvePackageRoot } from "./helpers/resolve-package-root";

describe("buildComponentIndex against a real historical carbon-components-svelte version", () => {
  test("old real version (0.85.0) indexes without throwing and resolves stable components", async () => {
    const carbonRoot = resolvePackageRoot("carbon-components-svelte-old");
    const index = await buildComponentIndex({ carbonRoot });

    expect(Object.keys(index).length).toBeGreaterThan(100);
    expect(index.Accordion?.path).toBe(
      "carbon-components-svelte/src/Accordion/Accordion.svelte",
    );
    expect(index.Button?.classes.length).toBeGreaterThan(0);

    // ContainedList was added to carbon-components-svelte after 0.85.0:
    // an old install simply not having it should never crash the build.
    expect(index.ContainedList).toBeUndefined();
  });
});

describe("buildComponentIndex against a renamed-helper layout (carbon-components-svelte#3790)", () => {
  test("resolves a kebab-case util file re-exported under its original camelCase name", async () => {
    // #3790 renames helper files to kebab-case and drops their default
    // export, while `index.js` keeps re-exporting the original camelCase
    // name. Resolution is driven off `index.js`'s re-export source, not off
    // matching the file's basename to the exported name, so this must keep
    // finding the file under its new name.
    const fixture = createFakeCarbonPackage({
      "index.js": `export { fuzzyMatch } from "./utils/fuzzy-match.js";`,
      "utils/fuzzy-match.js": `export function fuzzyMatch() {}`,
    });

    try {
      const index = await buildComponentIndex({ carbonRoot: fixture.root });

      expect(index.fuzzyMatch?.path).toBe(
        "carbon-components-svelte/src/utils/fuzzy-match.js",
      );
    } finally {
      fixture.dispose();
    }
  });
});
