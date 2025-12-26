import { optimizeImports } from "carbon-preprocess-svelte";
import type { Preprocessor, Processed } from "svelte/compiler";

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
import toHierarchy from "carbon-components-svelte/src/utils/toHierarchy.js";

import Add from "carbon-icons-svelte/lib/Add.svelte";
import Add2 from "carbon-icons-svelte/lib/Add.svelte";
import Add3 from "carbon-icons-svelte/lib/Add.svelte";

import Airplane from "carbon-pictograms-svelte/lib/Airplane.svelte";
import Airplane2 from "carbon-pictograms-svelte/lib/Airplane.svelte";
import Airplane3 from "carbon-pictograms-svelte/lib/Airplane.svelte";`);
  });

  test("invalid imports should be optimistic", () => {
    expect(
      preprocess({
        content: "import { NonExistent } from 'carbon-components-svelte'",
      }),
    ).toEqual(
      'import NonExistent from "carbon-components-svelte/src/NonExistent/NonExistent.svelte";',
    );
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
import filterTreeNodes from "carbon-components-svelte/src/utils/filterTreeNodes.js";
import toHierarchy from "carbon-components-svelte/src/utils/toHierarchy.js";
import NewComponent from "carbon-components-svelte/src/NewComponent/NewComponent.svelte";`);
  });
});
