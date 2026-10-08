import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFiles } from "../src/analyzer";
import { buildComponentModel } from "../src/analyzer/component-model";
import { createScope } from "../src/analyzer/evaluate";
import {
  dropUnusedDeclarations,
  type SpecializeOptions,
  specializeComponent,
} from "../src/analyzer/specialize";
import { addCallSite, newComponentUsage } from "../src/analyzer/usage";
import { OBJECT, possible, type Value } from "../src/analyzer/values";
import { parse } from "../src/indexer/parser";

/** Specializes `code` as a component whose one call site passes `props` (as values). */
function specializeWith(code: string, props: Map<string, Value>) {
  const model = buildComponentModel(code, "X/X.svelte");
  const usage = newComponentUsage();
  addCallSite(
    usage,
    { component: model.key, open: false, props, slots: new Set() },
    model.props.keys(),
  );
  const result = specializeComponent(
    createScope(model, usage, () => possible(undefined)),
  );
  parse(result.code);
  return result.code;
}

/** Specializes `code` as a component whose one call site passes `props`. */
function specialize(
  code: string,
  props: Record<string, string | number | boolean | undefined> = {},
  slots: string[] = [],
  options?: SpecializeOptions,
) {
  const model = buildComponentModel(code, "X/X.svelte");
  const usage = newComponentUsage();
  addCallSite(
    usage,
    {
      component: model.key,
      open: false,
      props: new Map(Object.entries(props).map(([k, v]) => [k, possible(v)])),
      slots: new Set(slots),
    },
    model.props.keys(),
  );
  const result = specializeComponent(
    createScope(model, usage, () => possible(undefined)),
    options,
  );
  parse(result.code);
  return result.code;
}

describe("specializeComponent", () => {
  test("folds known reads and removes branches that can't run", () => {
    const code = specialize(
      `<script>
  export let kind = "primary";
  export let skeleton = false;
  $: cls = kind === "ghost" ? "a" : "b";
</script>
{#if skeleton}<Skeleton />{:else}<button class={cls}>{kind}</button>{/if}`,
      { kind: "tertiary" },
    );
    expect(code).toContain(`export let kind = "primary";`);
    // The live branch keeps a block around it, so whitespace renders the
    // same in Svelte 3/4.
    expect(code).toContain(
      `{#if true}<button class={"b"}>{"tertiary"}</button>{/if}`,
    );
    expect(code).not.toContain("Skeleton");
  });

  test("`unwrap` replaces a block with its live branch (Svelte 5)", () => {
    const code = specialize(
      `<script>export let a = true;</script>
<p>
  {#if a}
    <!-- svelte-ignore a11y-missing-attribute -->
    <img />
  {:else}
    <b />
  {/if}
</p>`,
      {},
      [],
      { unwrap: true },
    );
    expect(code).toContain(
      "<p>\n  <!-- svelte-ignore a11y-missing-attribute --><img />\n</p>",
    );
  });

  test("keeps props declared and never folds what's written", () => {
    const code = specialize(
      `<script>
  export let open = false;
  let ref;
  function toggle() { open = !open; }
</script>
<div bind:this={ref} class:open={open} on:click={toggle} />`,
    );
    expect(code).toContain("export let open = false;");
    expect(code).toContain("class:open={open}");
    expect(code).toContain("bind:this={ref}");
  });

  test("expands shorthands instead of folding inside them", () => {
    const code = specialize(
      `<script>
  export let title = "Close";
  export let size = "sm";
  const props = { size };
</script>
<Icon {title} {...props} />`,
    );
    expect(code).toContain(`title={"Close"}`);
    expect(code).toContain(`size: "sm"`);
  });

  test("an unfilled slot is undefined, not false", () => {
    const code = specialize(
      `<script>
  export let icon = undefined;
  $: hasIcon = icon || $$slots.icon;
</script>
<div style={hasIcon && "width: 3rem"} />`,
    );
    expect(code).toContain("style={void 0}");
  });

  test("class directives fold to true or disappear", () => {
    const code = specialize(
      `<script>export let disabled = false; export let light = true;</script>
<div class:bx--disabled={disabled} class:bx--light={light} />`,
    );
    expect(code).not.toContain("bx--disabled");
    expect(code).toContain("class:bx--light={true}");
  });

  test("keeps whitespace on both sides of a removed block apart", () => {
    const code = specialize(
      `<script>export let a = false;</script>
<p>
  {#if a}A{/if}
  <slot />
</p>
<p><b />{#if a}A{/if}<i /></p>`,
    );
    // Between whitespace: a placeholder keeps the two from merging.
    expect(code).toContain("{#if false}<!---->{/if}\n  <slot />");
    // Between elements: removed outright.
    expect(code).toContain("<p><b /><i /></p>");
  });

  test("keeps a block around a live branch that declares `{@const}`", () => {
    const code = specialize(
      `<script>export let mode = "a";</script>
{#if mode === "a"}{@const x = 1}<p>{x}</p>{:else}<p>b</p>{/if}`,
    );
    expect(code).toContain("{#if true}{@const x = 1}");
  });

  test("if statements keep only the branch that can run", () => {
    const code = specialize(
      `<script>
  export let a = false;
  function f() {
    if (a) { one(); } else { two(); }
    if (a) three();
  }
</script>
<button on:click={f} />`,
    );
    expect(code).toContain("{ two(); }");
    expect(code).not.toContain("one()");
    expect(code).not.toContain("three()");
  });

  test("a ternary with a side-effecting test keeps the test", () => {
    const code = specialize(
      `<script>
  export let a = true;
  $: x = (log(), a) ? "yes" : expensive();
</script>
<p>{x}</p>`,
    );
    // The test still runs (and the statement stays); the branch that can't
    // run is gone, and `{x}` folds to its one value.
    expect(code).toContain('$: x = (log(), true) ? "yes" : void 0;');
    expect(code).toContain('<p>{"yes"}</p>');
  });

  test("`typeof` picks a branch when the value's type is known", () => {
    const source = `<script>
  export let total = undefined;
  $: hasTotal = typeof total === "number";
</script>
{#if hasTotal}<span class="total">{total}</span>{/if}`;
    expect(specialize(source)).not.toContain('class="total"');
    expect(specialize(source, { total: 5 })).toContain('class="total"');
  });

  test("an array that stays empty renders no `{#each}` body", () => {
    const code = specialize(
      `<script>export let items = [];</script>
<div>{#if items.length > 0}{#each items as item}<b>{item}</b>{/each}{/if}</div>
<ul>{#each items as item}<li>{item}</li>{:else}<p>None</p>{/each}</ul>`,
    );
    expect(code).toContain("<div>{#if false}<!---->{/if}</div>");
    expect(code).toContain("<ul>{#if true}<p>None</p>{/if}</ul>");
  });

  test.each([
    ["mutated", "onMount(() => items.push(1));"],
    ["aliased", "const copy = items;"],
    ["handed to a function", "load(items);"],
    ["truncated through `length`", "items.length = 0;"],
    ["reached through `$$props`", "const all = $$props;"],
  ])("an array %s may not stay empty", (_, statement) => {
    const code = specialize(
      `<script>export let items = []; ${statement}</script>
<ul>{#each items as item}<li>{item}</li>{/each}</ul>`,
    );
    expect(code).toContain("{#each items as item}");
  });

  test("an array a parent passes may hold items", () => {
    const code = specializeWith(
      `<script>export let items = []; $: label = $$props["aria-label"];</script>
<ul aria-label={label}>{#each items as item}<li>{item}</li>{/each}</ul>`,
      new Map([["items", possible(OBJECT)]]),
    );
    expect(code).toContain("{#each items as item}");
  });

  test("leaves expression statements' own value alone", () => {
    const code = specialize(`<script>export let a = "x"; $: { a; }</script>`);
    expect(code).toContain("$: { a; }");
  });
});

test("marks props nothing reads anymore so Svelte doesn't warn", () => {
  const code = specialize(
    `<script>
  export let warn = false;
  export let warnText = "";
  let className = undefined;
  export { className as class };
</script>
<div class={className}>{#if warn}<p>{warnText}</p>{/if}</div>`,
  );
  const ignore = "// svelte-ignore unused-export-let export_let_unused";
  expect(code).toContain(`${ignore}\n  export let warn = false;`);
  expect(code).toContain(`${ignore}\n  export let warnText = "";`);
  // Svelte 5 reports a renamed export at the `let`, Svelte 3/4 at `export`.
  expect(code).toContain(`${ignore}\n  let className = undefined;`);
  expect(code).toContain(`${ignore}\n  export { className as class };`);
});

test("a renamed export is a prop: `class` sets `className`", () => {
  const code = specialize(
    `<script>
  let className = undefined;
  export { className as class };
</script>
<div class={className} />`,
    { class: "custom" },
  );
  expect(code).toContain(`<div class={"custom"} />`);
});

describe("dropUnusedDeclarations", () => {
  test("removes unread, side-effect-free declarations until none are left", () => {
    const { code, dropped } = dropUnusedDeclarations(
      `<script>
  export let a = 1;
  $: b = a + 1;
  $: c = b * 2;
  $: d = compute(a);
  const e = 3;
</script>
<p>{a}</p>`,
    );
    expect(dropped).toBe(3);
    expect(code).toContain("export let a = 1;");
    expect(code).toContain("$: d = compute(a);");
    expect(code).not.toContain("$: b");
    expect(code).not.toContain("$: c");
    expect(code).not.toContain("const e");
  });

  test("keeps store writes and prop assignments, which have effects", () => {
    const { code, dropped } = dropUnusedDeclarations(
      `<script>
  import { writable } from "svelte/store";
  export let open = false;
  export let value = "";
  const shared = writable(open);
  $: $shared = open;
  $: value = "x";
</script>
<p>{open}</p>`,
    );
    expect(dropped).toBe(0);
    expect(code).toContain("$: $shared = open;");
    expect(code).toContain('$: value = "x";');
  });

  test("keeps declarations read by markup, stores, or directives", () => {
    const { dropped } = dropUnusedDeclarations(
      `<script>
  const store = 1;
  const flag = true;
  const name = "x";
</script>
<p class:flag>{$store}</p><input bind:value={name} />`,
    );
    expect(dropped).toBe(0);
  });
});

test("Carbon BigNumber without `total` drops the denominator", async () => {
  const dir = mkdtempSync(join(tmpdir(), "specialize-"));
  try {
    const file = join(dir, "App.svelte");
    const code = `<script>import { BigNumber } from "carbon-components-svelte";</script>\n<BigNumber value={42} />`;
    writeFileSync(file, code);
    const result = await analyzeFiles({
      projectRoot: process.cwd(),
      files: [{ file, code }],
      components: ["BigNumber"],
      options: {},
    });
    if ("warning" in result) throw new Error(result.warning);
    const scope = result.analysis.scopeFor("BigNumber/BigNumber.svelte");
    if (!scope) throw new Error("BigNumber isn't live");
    expect(result.isPruned(".bx--big-number__denominator")).toBe(true);
    const { code: rewritten } = specializeComponent(scope);
    parse(rewritten);
    expect(rewritten).not.toContain("bx--big-number__denominator");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Carbon Button for kind=tertiary", () => {
  test("drops the skeleton and tooltip and keeps the button", async () => {
    const dir = mkdtempSync(join(tmpdir(), "specialize-"));
    try {
      const file = join(dir, "App.svelte");
      const code = `<script>import { Button } from "carbon-components-svelte";</script>\n<Button kind="tertiary">Hi</Button>`;
      writeFileSync(file, code);
      const result = await analyzeFiles({
        projectRoot: process.cwd(),
        files: [{ file, code }],
        components: ["Button"],
        options: {},
      });
      if ("warning" in result) throw new Error(result.warning);
      const scope = result.analysis.scopeFor("Button/Button.svelte");
      if (!scope) throw new Error("Button isn't live");
      const specialized = specializeComponent(scope);
      parse(specialized.code);
      expect(specialized.code).not.toContain("<ButtonSkeleton");
      expect(specialized.code).not.toContain("<PortalTooltip");
      expect(specialized.code).toContain("<button");
      expect(specialized.code).toContain(`"bx--btn--tertiary"`);
      expect(specialized.unrendered()).toContain("./ButtonSkeleton.svelte");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
