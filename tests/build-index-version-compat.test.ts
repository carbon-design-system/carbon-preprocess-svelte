import { buildComponentIndex } from "../src/indexer/build-index";
import { createMockCarbonPackage } from "./helpers/mock-carbon-package";
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

describe("buildComponentIndex for a kebab-case util re-exported under a different name", () => {
  test("resolves a kebab-case util file re-exported under its original camelCase name", async () => {
    // Resolution follows index.js's re-export source, not the file basename.
    const fixture = createMockCarbonPackage({
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

describe("buildComponentIndex: classes hoisted out of a component", () => {
  test("a .js module's class literals reach every component importing it", async () => {
    const fixture = createMockCarbonPackage({
      "index.js": `export { default as Foo } from "./Foo/Foo.svelte";`,
      "Foo/Foo.svelte": `<script>
  import { HIGHLIGHT, sizeClass } from "./classes.js";
</script>
<div class="{HIGHLIGHT} {sizeClass('sm')}"></div>`,
      "Foo/classes.js": `import { inModal } from "../utils/lookups.js";
export const HIGHLIGHT = "bx--foo--highlighted";
export const sizeClass = (size) => \`bx--foo--\${size}\`;`,
      "utils/lookups.js": `export const inModal = (el) => el.closest(".bx--modal") !== null;
const RE_ROW = /^bx--(checkbox|radio-button)/;`,
    });

    try {
      const index = await buildComponentIndex({ carbonRoot: fixture.root });

      expect(index.Foo?.classes).toContain(".bx--foo--highlighted");
      expect(index.Foo?.classes).toContain(".bx--foo--");
      // Lookups find elements rendered elsewhere, and a bare `bx--` prefix
      // would keep every Carbon rule.
      expect(index.Foo?.classes).not.toContain(".bx--modal");
      expect(index.Foo?.classes).not.toContain(".bx--");
    } finally {
      fixture.dispose();
    }
  });
});
