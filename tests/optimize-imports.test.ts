import { optimizeImports } from "@";
import type { Preprocessor, Processed } from "svelte/types/compiler/preprocess";

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
import { invalid } from "carbon-components-svelte";

import { Add } from "carbon-icons-svelte";
import { Add as Add2 } from "carbon-icons-svelte";
import Add3 from "carbon-icons-svelte/lib/Add.svelte";

import { Airplane } from "carbon-pictograms-svelte";
import { Airplane as Airplane2 } from "carbon-pictograms-svelte";
import Airplane3 from "carbon-pictograms-svelte/lib/Airplane.svelte";`,
      }),
    )
      .toEqual(`import Accordion from "carbon-components-svelte/src/Accordion/Accordion.svelte";import AccordionItem from "carbon-components-svelte/src/Accordion/AccordionItem.svelte";
import Accordion2 from "carbon-components-svelte/src/Accordion/Accordion.svelte";
import breakpoints from "carbon-components-svelte/src/Breakpoint/breakpoints.js";
import { invalid } from "carbon-components-svelte";

import Add from "carbon-icons-svelte/lib/Add.svelte";
import Add2 from "carbon-icons-svelte/lib/Add.svelte";
import Add3 from "carbon-icons-svelte/lib/Add.svelte";

import Airplane from "carbon-pictograms-svelte/lib/Airplane.svelte";
import Airplane2 from "carbon-pictograms-svelte/lib/Airplane.svelte";
import Airplane3 from "carbon-pictograms-svelte/lib/Airplane.svelte";`);
  });
});
