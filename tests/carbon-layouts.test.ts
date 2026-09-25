import { buildComponentIndex } from "carbon-preprocess-svelte/indexer/build-index";
import {
  createCssOptimizer,
  createOptimizedCss,
} from "carbon-preprocess-svelte/plugins/create-optimized-css";
import { readCarbonExports } from "carbon-preprocess-svelte/preprocessors/carbon-exports";
import { transformScript } from "carbon-preprocess-svelte/preprocessors/optimize-imports";
import { createMockCarbonPackage } from "./helpers/mock-carbon-package";

const CSS = ".bx--btn{color:red}.bx--tag{color:blue}";
const BUTTON = `<button class="bx--btn"><slot /></button>`;
const TAG = `<span class="bx--tag"></span>`;
const TAG_EXPORT = `export { default as Tag } from "./Tag/Tag.svelte";`;

const bundled = (file: string) =>
  `/app/node_modules/carbon-components-svelte/src/${file}`;

// Layouts a future Carbon release could switch to. Both tools read the
// installed barrel, so neither may depend on files being named after
// their exports.
describe.each([
  [
    "a moved folder",
    {
      "index.js": `export { default as Button } from "./components/Button/Button.svelte";\n${TAG_EXPORT}`,
      "components/Button/Button.svelte": BUTTON,
    },
    "components/Button/Button.svelte",
  ],
  [
    "a file not named after its export",
    {
      "index.js": `export { default as Button } from "./Button/button.svelte";\n${TAG_EXPORT}`,
      "Button/button.svelte": BUTTON,
    },
    "Button/button.svelte",
  ],
  [
    "an index.svelte component",
    {
      "index.js": `export { default as Button } from "./Button/index.svelte";\n${TAG_EXPORT}`,
      "Button/index.svelte": BUTTON,
    },
    "Button/index.svelte",
  ],
  [
    "an internal file with the same name",
    {
      "index.js": `export { default as Button } from "./Button/Button.svelte";\n${TAG_EXPORT}`,
      "Button/Button.svelte": BUTTON,
      "Internal/Button.svelte": `<div class="bx--internal"></div>`,
    },
    "Button/Button.svelte",
  ],
  [
    "an `export *` barrel",
    {
      "index.js": `export * from "./Button";\n${TAG_EXPORT}`,
      "Button/index.js": `export { default as Button } from "./Button.svelte";`,
      "Button/Button.svelte": BUTTON,
    },
    "Button/Button.svelte",
  ],
  [
    "an import-then-export barrel",
    {
      "index.js": `import Button from "./Button/Button.svelte";\nexport { Button };\n${TAG_EXPORT}`,
      "Button/Button.svelte": BUTTON,
    },
    "Button/Button.svelte",
  ],
])("Carbon layout: %s", (_, files, buttonFile) => {
  let carbon: ReturnType<typeof createMockCarbonPackage>;

  beforeAll(() => {
    carbon = createMockCarbonPackage({ ...files, "Tag/Tag.svelte": TAG });
  });

  afterAll(() => {
    carbon.dispose();
  });

  test("optimizeImports rewrites to the file", () => {
    const exports = readCarbonExports(carbon.root);

    expect(
      transformScript(
        `import { Button } from "carbon-components-svelte";`,
        "App.svelte",
        () => exports,
      ).code,
    ).toBe(`import Button from "carbon-components-svelte/src/${buttonFile}";`);
  });

  test("optimizeCss keeps the bundled component's rules and prunes the rest", async () => {
    const components = await buildComponentIndex({ carbonRoot: carbon.root });
    const css = createOptimizedCss({
      source: CSS,
      components,
      ids: [bundled(buttonFile)],
    });

    expect(css).toContain(".bx--btn{");
    expect(css).not.toContain(".bx--tag");
  });
});

describe("internal components", () => {
  test("are indexed by path and keep their own classes when bundled", async () => {
    const carbon = createMockCarbonPackage({
      "index.js": `export { default as Button } from "./Button/Button.svelte";\n${TAG_EXPORT}`,
      "Button/Button.svelte": `<script>
  import ButtonIcon from "./ButtonIcon.svelte";
</script>
<button class="bx--btn"><ButtonIcon /></button>`,
      "Button/ButtonIcon.svelte": `<span class="bx--btn__icon"></span>`,
      "Tag/Tag.svelte": TAG,
    });

    try {
      const components = await buildComponentIndex({
        carbonRoot: carbon.root,
      });

      expect(components["Button/ButtonIcon.svelte"]).toEqual({
        path: "carbon-components-svelte/src/Button/ButtonIcon.svelte",
        classes: [".bx--btn__icon"],
        internal: true,
      });
      expect(components.Button.classes).toContain(".bx--btn__icon");

      const optimizer = createCssOptimizer({
        components,
        ids: [bundled("Button/ButtonIcon.svelte")],
      });

      expect(optimizer.run(`${CSS}.bx--btn__icon{fill:red}`).css).toContain(
        ".bx--btn__icon{",
      );
      // Only exported components are reported as imported.
      expect(optimizer.usage.components).toEqual([]);
    } finally {
      carbon.dispose();
    }
  });
});
