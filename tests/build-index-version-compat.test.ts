import { readFileSync } from "node:fs";
import path from "node:path";
import { buildComponentIndex } from "../src/indexer/build-index";
import { createOptimizedCss } from "../src/plugins/create-optimized-css";
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

  // 0.85.0's `Tabs.svelte` renders a `.bx--tabs-trigger` wrapper (mobile
  // dropdown-style trigger) via a `class:` directive; later releases dropped
  // it. An index built from a newer release doesn't list it under `Tabs`, so
  // pruning against one removed the (hiding) rule for apps still on an older
  // Carbon install (#213). Indexing the installed release picks the class
  // straight out of its actual markup.
  test("keeps a class only the old install's Tabs markup has, still pruning unrelated classes", async () => {
    const carbonRoot = resolvePackageRoot("carbon-components-svelte-old");
    const index = await buildComponentIndex({ carbonRoot });

    expect(index.Tabs?.classes).toEqual(
      expect.arrayContaining([".bx--tabs-trigger", ".bx--tabs-trigger-text"]),
    );

    const optimized = createOptimizedCss({
      source: readFileSync(path.join(carbonRoot, "css", "white.css"), "utf8"),
      components: index,
      ids: ["Tabs"],
    });

    expect(optimized).toContain(".bx--tabs-trigger{display:none}");
    expect(optimized).toContain(".bx--tabs-trigger-text{");
    // Strict pruning still drops classes owned by components that
    // weren't imported -- the fix is not "keep everything".
    expect(optimized).not.toContain(".bx--accordion");
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

describe("buildComponentIndex: classes hoisted into a module script", () => {
  test("a component importing another's module-script constants gets their classes", async () => {
    const fixture = createMockCarbonPackage({
      "index.js": `export { default as Foo } from "./Foo/Foo.svelte";
export { default as Bar } from "./Bar/Bar.svelte";`,
      "Foo/Foo.svelte": `<script context="module">
  export const SIZES = { sm: "bx--foo--sm" };
  export const inModal = (el) => el.closest(".bx--modal");
</script>
<div class={SIZES.sm}></div>`,
      // Imports Foo's constants without rendering Foo.
      "Bar/Bar.svelte": `<script>
  import { SIZES } from "../Foo/Foo.svelte";
</script>
<span class={SIZES.sm}></span>`,
    });

    try {
      const index = await buildComponentIndex({ carbonRoot: fixture.root });

      expect(index.Foo?.classes).toEqual(
        expect.arrayContaining([".bx--foo--sm", ".bx--modal"]),
      );
      expect(index.Bar?.classes).toContain(".bx--foo--sm");
      expect(index.Bar?.classes).not.toContain(".bx--modal");
    } finally {
      fixture.dispose();
    }
  });
});
