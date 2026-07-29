import { buildComponentIndex } from "../src/indexer/build-index";
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
