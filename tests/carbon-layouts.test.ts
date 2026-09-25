import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { optimizeImports } from "carbon-preprocess-svelte";
import { buildComponentIndex } from "carbon-preprocess-svelte/indexer/build-index";
import {
  createCssOptimizer,
  createOptimizedCss,
} from "carbon-preprocess-svelte/plugins/create-optimized-css";
import {
  readCarbonExports,
  readExportsPolicy,
} from "carbon-preprocess-svelte/preprocessors/carbon-exports";
import { transformScript } from "carbon-preprocess-svelte/preprocessors/optimize-imports";
import type { Processed } from "svelte/compiler";
import { createFakeProject } from "./helpers/fake-project";
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

describe("a bundled Carbon file missing from the index", () => {
  test("leaves CSS unpruned, since nothing is known about what it renders", async () => {
    const carbon = createMockCarbonPackage({
      "index.js": `export { default as Button } from "./Button/Button.svelte";\n${TAG_EXPORT}`,
      "Button/Button.svelte": BUTTON,
      "Tag/Tag.svelte": TAG,
    });

    try {
      const optimizer = createCssOptimizer({
        components: await buildComponentIndex({ carbonRoot: carbon.root }),
        ids: [bundled("Button/Button.svelte"), bundled("Gone/Gone.svelte")],
      });

      expect(optimizer.usage.unindexed).toEqual(["Gone/Gone.svelte"]);
      expect(optimizer.run(CSS)).toEqual({ css: CSS, removed: 0 });
    } finally {
      carbon.dispose();
    }
  });
});

describe("readExportsPolicy", () => {
  const BUTTON_PATH = "carbon-components-svelte/src/Button/Button.svelte";
  const UTIL_PATH = "carbon-components-svelte/src/utils/toCsv.js";

  test.each([
    ["no exports field", undefined, true, true],
    ["only the barrel (string)", "./src/index.js", false, false],
    [
      "only the barrel (conditions)",
      { svelte: "./src/index.js" },
      false,
      false,
    ],
    [
      "only .svelte files",
      { ".": "./src/index.js", "./src/*.svelte": "./src/*.svelte" },
      true,
      false,
    ],
    [
      "a longer pattern blocking a folder",
      { "./src/*": "./src/*", "./src/utils/*": null },
      true,
      false,
    ],
    [
      "an exact key overriding a pattern",
      { "./src/*": "./src/*", "./src/Button/Button.svelte": null },
      false,
      true,
    ],
    [
      "conditions with a non-null target",
      { "./src/*": { types: "./types/*.d.ts", import: "./src/*" } },
      true,
      true,
    ],
  ])("%s", (_, exportsField, button, util) => {
    const carbon = createMockCarbonPackage({});
    writeFileSync(
      path.join(carbon.root, "package.json"),
      JSON.stringify({
        name: "carbon-components-svelte",
        exports: exportsField,
      }),
    );

    try {
      const isImportable = readExportsPolicy(carbon.root);
      expect(isImportable(BUTTON_PATH)).toBe(button);
      expect(isImportable(UTIL_PATH)).toBe(util);
    } finally {
      carbon.dispose();
    }
  });
});

describe("a Carbon whose exports hide src/", () => {
  test("optimizeImports leaves imports on the barrel instead of breaking the build", () => {
    const project = createFakeProject();
    const carbon = createMockCarbonPackage({
      "index.js": `export { default as Button } from "./Button/Button.svelte";`,
      "Button/Button.svelte": BUTTON,
    });
    writeFileSync(
      path.join(carbon.root, "package.json"),
      JSON.stringify({
        name: "carbon-components-svelte",
        version: "9.0.0",
        exports: { ".": { svelte: "./src/index.js" } },
      }),
    );
    project.linkCarbon(project.root, carbon.root);
    mkdirSync(path.join(project.root, "src"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const preprocessor = optimizeImports();
      const content = `import { Button } from "carbon-components-svelte";`;
      for (const file of ["App.svelte", "Other.svelte"]) {
        const result = preprocessor.script({
          attributes: {},
          filename: path.join(project.root, "src", file),
          content,
          markup: "",
        }) as Processed;
        expect(result.code).toBe(content);
      }

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(
        "leaving those imports on the barrel",
      );
    } finally {
      warn.mockRestore();
      project.dispose();
      carbon.dispose();
    }
  });
});
