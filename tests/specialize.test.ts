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
import { possible } from "../src/analyzer/values";
import { parse } from "../src/indexer/parser";

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
    expect(code).toContain("{#if false}{/if}\n  <slot />");
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

  test("leaves expression statements' own value alone", () => {
    const code = specialize(`<script>export let a = "x"; $: { a; }</script>`);
    expect(code).toContain("$: { a; }");
  });
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
