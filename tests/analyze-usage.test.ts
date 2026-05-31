import type { ComponentConditions } from "carbon-preprocess-svelte/plugins/analyze-usage";
import {
  computePruneSet,
  extractUsages,
} from "carbon-preprocess-svelte/plugins/analyze-usage";

const wrap = (markup: string) =>
  `<script>import { Button } from "carbon-components-svelte";</script>\n${markup}`;

describe("extractUsages", () => {
  test("records literal prop values and boolean shorthand", () => {
    const { ok, observed } = extractUsages({
      filename: "App.svelte",
      code: wrap(`<Button size="lg" />\n<Button expressive />`),
    });
    expect(ok).toBe(true);
    expect(observed.Button.instances).toBe(2);
    expect(observed.Button.props.size.values).toEqual(["lg"]);
    expect(observed.Button.props.expressive.values).toEqual([true]);
  });

  test("poisons a prop bound dynamically", () => {
    const { observed } = extractUsages({
      filename: "App.svelte",
      code: wrap(`<Button size={mySize} />`),
    });
    expect(observed.Button.props.size.poisoned).toBe(true);
  });

  test("poisons a prop bound via bind:", () => {
    const { observed } = extractUsages({
      filename: "App.svelte",
      code: wrap(`<Button bind:ref />`),
    });
    expect(observed.Button.props.ref.poisoned).toBe(true);
  });

  test("a spread poisons the whole component", () => {
    const { observed } = extractUsages({
      filename: "App.svelte",
      code: wrap(`<Button {...rest} size="lg" />`),
    });
    expect(observed.Button.spreadPoison).toBe(true);
  });

  test("flags a dynamic <svelte:component>", () => {
    const { dynamicComponent } = extractUsages({
      filename: "App.svelte",
      code: `<svelte:component this={Which} />`,
    });
    expect(dynamicComponent).toBe(true);
  });

  test("ignores non-Carbon components", () => {
    const { observed } = extractUsages({
      filename: "App.svelte",
      code: `<script>import Local from "./Local.svelte";</script>\n<Local size="lg" />`,
    });
    expect(observed.Local).toBeUndefined();
  });

  test("returns ok=false for unparseable source", () => {
    const { ok } = extractUsages({
      filename: "App.svelte",
      code: `<script>const = ;</script>`,
    });
    expect(ok).toBe(false);
  });
});

describe("computePruneSet", () => {
  const conditions: Record<string, ComponentConditions> = {
    Button: {
      conditional: {
        ".bx--btn--lg": { kind: "eq", prop: "size", values: ["lg"] },
        ".bx--btn--expressive": { kind: "truthy", prop: "expressive" },
        ".bx--btn--noDefault": { kind: "eq", prop: "foo", values: ["a"] },
      },
      unconditional: [".bx--btn"],
      propDefaults: { size: "default", expressive: false },
    },
  };

  const pruneFor = (
    markup: string,
    index: Record<string, ComponentConditions> = conditions,
  ) =>
    computePruneSet(
      index,
      extractUsages({ filename: "App.svelte", code: wrap(markup) }).observed,
    );

  test("prunes an eq class whose value is never used", () => {
    const prune = pruneFor(`<Button size="sm" />`);
    expect(prune.has(".bx--btn--lg")).toBe(true);
  });

  test("keeps an eq class whose value is used somewhere", () => {
    const prune = pruneFor(`<Button size="sm" />\n<Button size="lg" />`);
    expect(prune.has(".bx--btn--lg")).toBe(false);
  });

  test("keeps an eq class when its prop is bound dynamically", () => {
    const prune = pruneFor(`<Button size={dynamic} />`);
    expect(prune.has(".bx--btn--lg")).toBe(false);
  });

  test("prunes a truthy class when the prop defaults falsy and is never set", () => {
    const prune = pruneFor(`<Button size="sm" />`);
    expect(prune.has(".bx--btn--expressive")).toBe(true);
  });

  test("keeps a truthy class when the prop is set", () => {
    const prune = pruneFor(`<Button expressive />`);
    expect(prune.has(".bx--btn--expressive")).toBe(false);
  });

  test("keeps a class when an instance omits the prop and there is no default", () => {
    const prune = pruneFor(`<Button size="sm" />`);
    expect(prune.has(".bx--btn--noDefault")).toBe(false);
  });

  test("never prunes a class that is unconditional in another component", () => {
    const withUnconditional: Record<string, ComponentConditions> = {
      ...conditions,
      Wrapper: {
        conditional: {},
        unconditional: [".bx--btn--lg"],
        propDefaults: {},
      },
    };
    const prune = pruneFor(`<Button size="sm" />`, withUnconditional);
    expect(prune.has(".bx--btn--lg")).toBe(false);
  });
});
