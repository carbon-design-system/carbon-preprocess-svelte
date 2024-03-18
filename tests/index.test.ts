import { expect, test } from "bun:test";
import type { Processed } from "svelte/types/compiler/preprocess";
import { optimizeImports } from "../src";

const preprocess = (content: string) => {
  return (
    optimizeImports().script({
      filename: "test.svelte",
      content,
      attributes: {},
      markup: "",
    }) as Processed
  ).code;
};

test("optimizeImports", () => {
  expect(
    preprocess(`
        import { Accordion, AccordionItem } from "carbon-components-svelte";
        import { Accordion as Accordion2 } from "carbon-components-svelte";
        import { breakpoints } from "carbon-components-svelte";
        import { invalid } from "carbon-components-svelte";

        import { Add } from "carbon-icons-svelte";
        import { Add as Add2 } from "carbon-icons-svelte";
        import Add3 from "carbon-icons-svelte/lib/Add.svelte";

        import { Airplane } from "carbon-pictograms-svelte";
        import { Airplane as Airplane2 } from "carbon-pictograms-svelte";
        import Airplane3 from "carbon-pictograms-svelte/lib/Airplane.svelte";
    `),
  ).toMatchSnapshot();
});
