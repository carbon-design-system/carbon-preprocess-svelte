import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { optimizeImports } from "carbon-preprocess-svelte";
import { readCarbonExports } from "carbon-preprocess-svelte/preprocessors/carbon-exports";
import { transformScript } from "carbon-preprocess-svelte/preprocessors/optimize-imports";
import type { Preprocessor, Processed } from "svelte/compiler";
import { createFakeProject } from "./helpers/fake-project";
import { createMockCarbonPackage } from "./helpers/mock-carbon-package";
import { resolvePackageRoot } from "./helpers/resolve-package-root";

const preprocess = (options?: Partial<Parameters<Preprocessor>[0]>) => {
  return (
    optimizeImports().script({
      attributes: {},
      filename: "test.svelte",
      content: "",
      markup: "",
      ...options,
    }) as Processed
  )?.code;
};

describe("optimizeImports", () => {
  test("preprocessor is skipped", () => {
    expect(preprocess({ filename: undefined })).toBeUndefined();
    expect(preprocess({ filename: "node_modules" })).toBeUndefined();
    expect(
      preprocess({ filename: "node_modules/carbon-components-svelte" }),
    ).toBeUndefined();
  });

  test("files without a carbon- substring are returned untouched", () => {
    expect(
      preprocess({
        content: `import { something } from "other-module";
import defaultThing from "another-module";`,
      }),
    ).toBeUndefined();
  });

  test("barrel imports", () => {
    expect(
      preprocess({
        content: `import { Accordion, AccordionItem } from "carbon-components-svelte";
import { Accordion as Accordion2 } from "carbon-components-svelte";
import { breakpoints } from "carbon-components-svelte";
import { toHierarchy } from "carbon-components-svelte";

import { Add } from "carbon-icons-svelte";
import { Add as Add2 } from "carbon-icons-svelte";
import Add3 from "carbon-icons-svelte/lib/Add.svelte";

import { Airplane } from "carbon-pictograms-svelte";
import { Airplane as Airplane2 } from "carbon-pictograms-svelte";
import Airplane3 from "carbon-pictograms-svelte/lib/Airplane.svelte";`,
      }),
    ).toEqual(`import Accordion from "carbon-components-svelte/src/Accordion/Accordion.svelte";
import AccordionItem from "carbon-components-svelte/src/Accordion/AccordionItem.svelte";
import Accordion2 from "carbon-components-svelte/src/Accordion/Accordion.svelte";
import breakpoints from "carbon-components-svelte/src/Breakpoint/breakpoints.js";
import { toHierarchy } from "carbon-components-svelte/src/utils/toHierarchy.js";

import Add from "carbon-icons-svelte/lib/Add.svelte";
import Add2 from "carbon-icons-svelte/lib/Add.svelte";
import Add3 from "carbon-icons-svelte/lib/Add.svelte";

import Airplane from "carbon-pictograms-svelte/lib/Airplane.svelte";
import Airplane2 from "carbon-pictograms-svelte/lib/Airplane.svelte";
import Airplane3 from "carbon-pictograms-svelte/lib/Airplane.svelte";`);
  });

  test("named re-exports from one module stay named imports of its .js file", () => {
    expect(
      preprocess({
        content: `import { filterTreeById, filterTreeByText as byText, filterTreeNodes } from "carbon-components-svelte";`,
      }),
    ).toEqual(`import { filterTreeById } from "carbon-components-svelte/src/utils/filterTreeNodes.js";
import { filterTreeByText as byText } from "carbon-components-svelte/src/utils/filterTreeNodes.js";
import { filterTreeNodes } from "carbon-components-svelte/src/utils/filterTreeNodes.js";`);
  });

  test("names the installed barrel doesn't export stay on the barrel", () => {
    expect(
      preprocess({
        content: "import { NonExistent } from 'carbon-components-svelte'",
      }),
    ).toEqual("import { NonExistent } from 'carbon-components-svelte'");
  });

  test("unknown camelCase utility is left untouched", () => {
    expect(
      preprocess({
        content: `import { someFutureUtil } from "carbon-components-svelte"`,
      }),
    ).toEqual(`import { someFutureUtil } from "carbon-components-svelte"`);
  });

  test("mixed component and un-indexed utility import", () => {
    expect(
      preprocess({
        content: `import { Button, someFutureUtil } from "carbon-components-svelte";`,
      }),
    ).toEqual(`import Button from "carbon-components-svelte/src/Button/Button.svelte";
import { someFutureUtil } from "carbon-components-svelte";`);
  });

  test("mixed imports should be handled correctly", () => {
    expect(
      preprocess({
        content: `import { Accordion, AccordionItem, breakpoints as bp } from "carbon-components-svelte";
import { Add, Download } from "carbon-icons-svelte";
import { Airplane, Analytics } from "carbon-pictograms-svelte";`,
      }),
    ).toEqual(`import Accordion from "carbon-components-svelte/src/Accordion/Accordion.svelte";
import AccordionItem from "carbon-components-svelte/src/Accordion/AccordionItem.svelte";
import bp from "carbon-components-svelte/src/Breakpoint/breakpoints.js";
import Add from "carbon-icons-svelte/lib/Add.svelte";
import Download from "carbon-icons-svelte/lib/Download.svelte";
import Airplane from "carbon-pictograms-svelte/lib/Airplane.svelte";
import Analytics from "carbon-pictograms-svelte/lib/Analytics.svelte";`);
  });

  test("default imports should be preserved", () => {
    expect(
      preprocess({
        content: `import Default from "other-module";
                 import { Accordion } from "carbon-components-svelte";`,
      }),
    ).toEqual(`import Default from "other-module";
                 import Accordion from "carbon-components-svelte/src/Accordion/Accordion.svelte";`);
  });

  test("namespace imports should be preserved", () => {
    expect(
      preprocess({
        content: `import * as namespace from "other-module";
                 import { Accordion } from "carbon-components-svelte";`,
      }),
    ).toEqual(`import * as namespace from "other-module";
                 import Accordion from "carbon-components-svelte/src/Accordion/Accordion.svelte";`);
  });

  test("multiple import statements for same module", () => {
    expect(
      preprocess({
        content: `
          import { Accordion } from "carbon-components-svelte";
          import { AccordionItem } from "carbon-components-svelte";
          import { Add } from "carbon-icons-svelte";
          import { Download } from "carbon-icons-svelte";
        `,
      }),
    ).toEqual(`
          import Accordion from "carbon-components-svelte/src/Accordion/Accordion.svelte";
          import AccordionItem from "carbon-components-svelte/src/Accordion/AccordionItem.svelte";
          import Add from "carbon-icons-svelte/lib/Add.svelte";
          import Download from "carbon-icons-svelte/lib/Download.svelte";
        `);
  });

  test("empty import statements are ignored", () => {
    expect(
      preprocess({
        content: `import { } from "carbon-components-svelte";`,
      }),
    ).toEqual(`import { } from "carbon-components-svelte";`);
  });

  test("non-carbon imports should be preserved", () => {
    expect(
      preprocess({
        content: `
          import { something } from "other-module";
          import defaultThing from "another-module";
          import { Accordion } from "carbon-components-svelte";
        `,
      }),
    ).toEqual(`
          import { something } from "other-module";
          import defaultThing from "another-module";
          import Accordion from "carbon-components-svelte/src/Accordion/Accordion.svelte";
        `);
  });

  test("import type statements should be preserved", () => {
    expect(
      preprocess({
        content: `
          import { Theme } from "carbon-components-svelte";
          import type { CarbonTheme } from "carbon-components-svelte/src/Theme/Theme.svelte";
        `,
      }),
    ).toEqual(`
          import Theme from "carbon-components-svelte/src/Theme/Theme.svelte";
          import type { CarbonTheme } from "carbon-components-svelte/src/Theme/Theme.svelte";
        `);
  });

  test("type-only barrel statements are left untouched", () => {
    expect(
      preprocess({
        content: `import type { ButtonProps } from "carbon-components-svelte";`,
      }),
    ).toEqual(`import type { ButtonProps } from "carbon-components-svelte";`);
  });

  test("type-only specifiers stay on the barrel while values are rewritten", () => {
    expect(
      preprocess({
        content: `import { Button, type ButtonSize } from "carbon-components-svelte";`,
      }),
    ).toEqual(`import Button from "carbon-components-svelte/src/Button/Button.svelte";
import { type ButtonSize } from "carbon-components-svelte";`);
  });

  test("backward compatibility with various export patterns", () => {
    expect(
      preprocess({
        content: `import { Accordion, AccordionItem, AccordionSkeleton } from "carbon-components-svelte";
import { breakpointObserver, breakpoints } from "carbon-components-svelte";
import { ContainedList, ContainedListItem } from "carbon-components-svelte";
import { filterTreeNodes, toHierarchy } from "carbon-components-svelte";
import { NewComponent } from "carbon-components-svelte";`,
      }),
    ).toEqual(`import Accordion from "carbon-components-svelte/src/Accordion/Accordion.svelte";
import AccordionItem from "carbon-components-svelte/src/Accordion/AccordionItem.svelte";
import AccordionSkeleton from "carbon-components-svelte/src/Accordion/AccordionSkeleton.svelte";
import breakpointObserver from "carbon-components-svelte/src/Breakpoint/breakpointObserver.js";
import breakpoints from "carbon-components-svelte/src/Breakpoint/breakpoints.js";
import ContainedList from "carbon-components-svelte/src/ContainedList/ContainedList.svelte";
import ContainedListItem from "carbon-components-svelte/src/ContainedList/ContainedListItem.svelte";
import { filterTreeNodes } from "carbon-components-svelte/src/utils/filterTreeNodes.js";
import { toHierarchy } from "carbon-components-svelte/src/utils/toHierarchy.js";
import { NewComponent } from "carbon-components-svelte";`);
  });

  test("the script hook resolves synchronously", () => {
    const result = optimizeImports().script({
      attributes: {},
      filename: "test.svelte",
      content: `import { Button } from "carbon-components-svelte";`,
      markup: "",
    });

    expect(result).not.toBeInstanceOf(Promise);
    expect((result as Processed).code).toEqual(
      `import Button from "carbon-components-svelte/src/Button/Button.svelte";`,
    );
  });

  test("each file gets the barrel of the Carbon install its directory resolves", () => {
    // Two apps on Carbon releases that moved `Button`, one preprocessor.
    const project = createFakeProject();
    const carbons = ["Button", "Buttons"].map((folder, version) => {
      const carbon = createMockCarbonPackage({
        "index.js": `export { default as Button } from "./${folder}/Button.svelte";`,
        [`${folder}/Button.svelte`]: "<button />",
      });
      writeFileSync(
        path.join(carbon.root, "package.json"),
        JSON.stringify({
          name: "carbon-components-svelte",
          version: `0.${version}.0`,
        }),
      );
      return carbon;
    });
    const apps = carbons.map((carbon, i) => {
      const app = path.join(project.root, "apps", `app-${i}`);
      mkdirSync(path.join(app, "src"), { recursive: true });
      project.linkCarbon(app, carbon.root);
      return app;
    });

    try {
      const preprocessor = optimizeImports();
      const [first, second] = apps.map(
        (app) =>
          (
            preprocessor.script({
              attributes: {},
              filename: path.join(app, "src", "App.svelte"),
              content: `import { Button } from "carbon-components-svelte";`,
              markup: "",
            }) as Processed
          ).code,
      );

      expect(first).toEqual(
        `import Button from "carbon-components-svelte/src/Button/Button.svelte";`,
      );
      expect(second).toEqual(
        `import Button from "carbon-components-svelte/src/Buttons/Button.svelte";`,
      );
    } finally {
      project.dispose();
      for (const carbon of carbons) carbon.dispose();
    }
  });

  test("icon-only files never read carbon-components-svelte", () => {
    const loadExports = jest.fn(() => new Map());

    expect(
      transformScript(
        `import { Add } from "carbon-icons-svelte";`,
        "test.svelte",
        loadExports,
      ).code,
    ).toEqual(`import Add from "carbon-icons-svelte/lib/Add.svelte";`);
    expect(loadExports).not.toHaveBeenCalled();
  });
});

describe("readCarbonExports", () => {
  const rewrite = (content: string, carbonRoot: string) => {
    const exports = readCarbonExports(carbonRoot);
    return transformScript(content, "test.svelte", () => exports).code;
  };

  // 0.85.0 re-exports every component through its folder's `index.js`
  // (`export { Accordion } from "./Accordion"`) and predates ContainedList.
  test("follows folder re-exports in a real old release (0.85.0)", () => {
    expect(
      rewrite(
        `import { Accordion, breakpoints, ContainedList } from "carbon-components-svelte";`,
        resolvePackageRoot("carbon-components-svelte-old"),
      ),
    ).toEqual(`import Accordion from "carbon-components-svelte/src/Accordion/Accordion.svelte";
import breakpoints from "carbon-components-svelte/src/Breakpoint/breakpoints.js";
import { ContainedList } from "carbon-components-svelte";`);
  });

  test("resolves extensionless, aliased, and multi-hop re-exports", () => {
    const fixture = createMockCarbonPackage({
      "index.js": `// export { Commented } from "./nowhere";
export { default as Button } from "./Button/Button.svelte";
export {
  Tabs,
  Tab as TabItem,
} from "./Tabs";
export { fuzzyMatch } from "./utils/fuzzy-match";`,
      "Button/Button.svelte": "<button />",
      "Tabs/index.js": `export { default as Tabs } from "./Tabs.svelte";
export { default as Tab } from "./Tab.svelte";`,
      "Tabs/Tabs.svelte": "<div />",
      "Tabs/Tab.svelte": "<div />",
      "utils/fuzzy-match.js": "export function fuzzyMatch() {}",
    });

    try {
      expect(Object.fromEntries(readCarbonExports(fixture.root))).toEqual({
        Button: {
          path: "carbon-components-svelte/src/Button/Button.svelte",
          name: "default",
        },
        Tabs: {
          path: "carbon-components-svelte/src/Tabs/Tabs.svelte",
          name: "default",
        },
        TabItem: {
          path: "carbon-components-svelte/src/Tabs/Tab.svelte",
          name: "default",
        },
        fuzzyMatch: {
          path: "carbon-components-svelte/src/utils/fuzzy-match.js",
          name: "fuzzyMatch",
        },
      });

      expect(
        rewrite(
          `import { fuzzyMatch, TabItem } from "carbon-components-svelte";`,
          fixture.root,
        ),
      ).toEqual(`import { fuzzyMatch } from "carbon-components-svelte/src/utils/fuzzy-match.js";
import TabItem from "carbon-components-svelte/src/Tabs/Tab.svelte";`);
    } finally {
      fixture.dispose();
    }
  });
});
