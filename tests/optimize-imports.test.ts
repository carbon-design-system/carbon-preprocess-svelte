import { describe, expect, test } from "bun:test";
import type { Preprocessor, Processed } from "svelte/types/compiler/preprocess";
import { optimizeImports } from "../src";

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
      preprocess({ filename: "node_modules/carbon-components-svelte" })
    ).toBeUndefined();
  });

  test("barrel imports", () => {
    expect(
      preprocess({
        content: `
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
    `,
      })
    ).toMatchSnapshot();
  });
});
