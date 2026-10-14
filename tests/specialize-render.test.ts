import {
  appRendering,
  type LibraryApp,
  renderSpecialized,
  specializedLibrary,
} from "./helpers/render-library";

// Each app renders the same HTML with the library rewritten for it as
// without: SSR, Svelte 5, `unwrap` off and on.

const CONTENT_LIBRARY = {
  "Card.svelte": `<script>
  let { children, header, title = "t" } = $props();
</script>
<div class="card">
  {#if header}<h2>{@render header()}</h2>{:else}<h2>no header</h2>{/if}
  {#if children}<div class="body">{@render children()}</div>{:else}<p>empty</p>{/if}
  <span>{title}</span>
</div>`,
  "Legacy.svelte": `<script>
  export let children = undefined;
</script>
<section>
  {#if $$slots.header}<slot name="header" />{:else}<i>no header slot</i>{/if}
  {#if $$slots.default}<slot />{:else}<i>no default slot</i>{/if}
  {#if children}<b>children prop</b>{:else}<b>no children prop</b>{/if}
  {#if $$props.children}<u>in $$props</u>{:else}<u>not in $$props</u>{/if}
</section>`,
  "Inner.svelte": `<script>
  let { children, header } = $props();
</script>
{#if children}<em>children</em>{:else}<em>no children</em>{/if}
{#if header}<em>header</em>{:else}<em>no header</em>{/if}`,
  "Outer.svelte": `<script>
  import Inner from "./Inner.svelte";
  let { mode = "a" } = $props();
</script>
{#if mode === "a"}
  <Inner>{#snippet header()}H{/snippet}</Inner>
{:else if mode === "b"}
  <Inner>text</Inner>
{:else}
  <Inner />
{/if}`,
  "RestLegacy.svelte": `<script>
  import Inner from "./Inner.svelte";
</script>
<Inner {...$$restProps} />`,
  "RestRunes.svelte": `<script>
  import Inner from "./Inner.svelte";
  let { ...rest } = $props();
</script>
<Inner {...rest} />`,
};

const content = (app: Record<string, string>): LibraryApp => ({
  lib: CONTENT_LIBRARY,
  app,
});

const SHAPES: Record<string, LibraryApp> = {
  "content as children": content(appRendering("<Card>hi</Card>")),
  "a snippet as its prop": content(
    appRendering("<Card>{#snippet header()}H{/snippet}</Card>"),
  ),
  "content at one site, a snippet at another": content(
    appRendering(
      "<Card>body</Card><Card>{#snippet header()}H{/snippet}</Card>",
    ),
  ),
  "a snippet named children": content(
    appRendering("<Card>{#snippet children()}C{/snippet}</Card>"),
  ),
  "children as an attribute": content(
    appRendering("{#snippet s()}S{/snippet}<Card children={s} />"),
  ),
  "no content": content(appRendering("<Card />")),
  "a slot attribute, in legacy mode": content(
    appRendering('<Legacy><span slot="header">h</span></Legacy>'),
  ),
  "a snippet filling a slot, in legacy mode": content(
    appRendering("<Legacy>{#snippet header()}H{/snippet}</Legacy>"),
  ),
  "content as children, in legacy mode": content(
    appRendering("<Legacy>content</Legacy>"),
  ),
  "no content, in legacy mode": content(appRendering("<Legacy />")),
  "content one library component passes another": content(
    appRendering('<Outer /><Outer mode="b" /><Outer mode="c" />'),
  ),
  "a snippet one library component passes another": content(
    appRendering("<Outer />"),
  ),
  "content left out of $$restProps": content(
    appRendering("<RestLegacy>content</RestLegacy>"),
  ),
  "content kept in the rest of $props()": content(
    appRendering("<RestRunes>content</RestRunes>"),
  ),
  "content an app component passes on": content({
    ...appRendering(
      "<Wrap>x</Wrap><Wrap />",
      'import Wrap from "./Wrap.svelte";',
    ),
    "Wrap.svelte": `<script>
  import { Card } from "mylib";
  let { children } = $props();
</script>
{#if children}<Card>{@render children()}</Card>{:else}<Card />{/if}`,
  }),
};

describe("specialized libraries render as the original", () => {
  const cases = Object.keys(SHAPES).flatMap((name): [string, boolean][] => [
    [name, false],
    [name, true],
  ]);
  test.each(cases)("%s (unwrap: %p)", async (name, unwrap) => {
    const { before, after } = await renderSpecialized(SHAPES[name], { unwrap });
    expect(after).toBe(before);
  });
});

// Props a parent sets through the instance `bind:this` binds (`$set`,
// accessors), or that a custom element's attributes set, aren't call
// sites: such a component keeps every value. One whose instance is only
// read for what it exports is still rewritten.

const INSTANCE_LIBRARY = {
  "Kind.svelte": `<svelte:options accessors />
<script>
  export let kind = "a";
  export function open() {}
</script>
{#if kind === "b"}<b>B</b>{:else}<i>A</i>{/if}`,
  "Element.svelte": `<svelte:options customElement="x-element" />
<script>
  export let kind = "a";
</script>
{#if kind === "b"}<b>B</b>{:else}<i>A</i>{/if}`,
  "Outer.svelte": `<script>
  import Kind from "./Kind.svelte";
  let kind;
  $: kind?.$set({ kind: "b" });
</script>
<Kind bind:this={kind} />`,
};

const instance = (markup: string, script = ""): LibraryApp => ({
  lib: INSTANCE_LIBRARY,
  app: appRendering(markup, script),
});

const KEEPS_EVERY_VALUE: Record<string, LibraryApp> = {
  "an accessor written": instance(
    '<Kind bind:this={k} /><button on:click={() => (k.kind = "b")}>b</button>',
    "let k;",
  ),
  "`$set` called": instance(
    '<Kind bind:this={k} /><button on:click={() => k.$set({ kind: "b" })}>b</button>',
    "let k;",
  ),
  "the instance handed on": instance(
    "<Kind bind:this={k} />",
    "import { register } from './register.js';\nlet k;\n$: register(k);",
  ),
  "the instance bound to a property": instance(
    "<Kind bind:this={refs.k} />",
    "const refs = {};",
  ),
  "an accessor read": instance("<Kind bind:this={k} />{k?.kind}", "let k;"),
  "`$set` called by a library component": instance("<Outer />"),
  "a custom element": instance("<Element />"),
};

const STILL_REWRITTEN: Record<string, LibraryApp> = {
  "an export called": instance(
    "<Kind bind:this={k} /><button on:click={() => k.open()}>open</button>",
    "let k;",
  ),
  "an export called after a test": instance(
    "<Kind bind:this={k} /><button on:click={() => k && k.open()}>open</button>{#if k}bound{/if}",
    "let k;",
  ),
  "an export called optionally": instance(
    "<Kind bind:this={k} /><button on:click={() => k?.open()}>open</button>",
    "let k;",
  ),
};

describe("props set outside call sites", () => {
  test.each(Object.keys(KEEPS_EVERY_VALUE))("%s keeps them", async (name) => {
    const sources = await specializedLibrary(KEEPS_EVERY_VALUE[name]);
    const component = name === "a custom element" ? "Element" : "Kind";
    expect(sources[`${component}.svelte`]).toContain("<b>B</b>");
  });

  test.each(Object.keys(STILL_REWRITTEN))("%s still rewrites", async (name) => {
    const sources = await specializedLibrary(STILL_REWRITTEN[name]);
    expect(sources["Kind.svelte"]).not.toContain("<b>B</b>");
    const { before, after } = await renderSpecialized(STILL_REWRITTEN[name], {
      unwrap: false,
    });
    expect(after).toBe(before);
  });
});

// A library component may render another package's components and import
// its own modules as a namespace.

const IMPORTS_LIBRARY = {
  "Inner.svelte": `<script>
  export let kind = "a";
</script>
{#if kind === "b"}<b>B</b>{:else}<i>A</i>{/if}`,
  "Tag.svelte": `<script>
  import * as L from "./index.js";
</script>
<L.Inner kind="b" />`,
  "Value.svelte": `<script>
  import * as L from "./index.js";
</script>
<svelte:component this={L.Inner} kind="b" />`,
  "Bare.svelte": `<script>
  import * as L from "./index.js";
  const all = L;
</script>
<svelte:component this={all.Inner} kind="b" />`,
  "Wraps.svelte": `<script>
  import Frame from "frame-kit";
  import * as Kit from "frame-kit";
  import Inner from "./Inner.svelte";
  export let kind = "a";
</script>
<Frame title={kind}>
  <Inner {kind} />
  {#if kind === "z"}<p>z</p>{/if}
</Frame>
<Kit.Frame><Inner kind="b" /></Kit.Frame>`,
};

const PACKAGES = {
  "frame-kit": {
    "index.js": 'export { default, default as Frame } from "./Frame.svelte";',
    "Frame.svelte": `<script>
  export let title = "";
</script>
<div class="frame" {title}><slot /></div>`,
  },
};

const imports = (markup: string): LibraryApp => ({
  lib: IMPORTS_LIBRARY,
  app: appRendering(markup),
  packages: PACKAGES,
});

describe("imports a library component renders through", () => {
  const RENDER: Record<string, LibraryApp> = {
    "a namespace member as a tag": imports("<Tag />"),
    "a namespace member and an import": imports("<Tag /><Inner />"),
    "a namespace member as a value": imports("<Value /><Inner />"),
    "another package's component": imports("<Wraps />"),
  };
  const cases = Object.keys(RENDER).flatMap((name): [string, boolean][] => [
    [name, false],
    [name, true],
  ]);
  test.each(cases)("%s (unwrap: %p)", async (name, unwrap) => {
    const { before, after } = await renderSpecialized(RENDER[name], { unwrap });
    expect(after).toBe(before);
  });

  test("a namespace member's props are read", async () => {
    const sources = await specializedLibrary(imports("<Tag />"));
    expect(sources["Inner.svelte"]).not.toContain("<i>A</i>");
  });

  test("another package's component leaves the rest rewritten", async () => {
    const sources = await specializedLibrary(imports("<Wraps />"));
    expect(sources["Wraps.svelte"]).not.toContain("<p>z</p>");
  });

  test("a namespace used as a value turns the analysis off", async () => {
    await expect(
      specializedLibrary(imports("<Bare /><Inner />")),
    ).rejects.toThrow("Bare.svelte uses `L`, a namespace import, as a value");
  });
});
