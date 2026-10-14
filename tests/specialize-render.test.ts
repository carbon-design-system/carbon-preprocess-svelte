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
    ).rejects.toThrow(
      "Bare.svelte uses `L`, an object of components, as a value",
    );
  });
});

// Svelte syntax the rewrite has to keep working around: each component
// branches on `kind`, which every call site passes as "b".

/** A component that renders `body` and branches on `kind`, in runes mode. */
const runes = (body: string, script = "", lang = "") => `<script${lang}>
  let { kind = "a" } = $props();
  ${script}
</script>
{#if kind === "a"}<i>A</i>{:else}<b>B</b>{/if}
${body}`;

/** The same, in legacy mode. */
const legacy = (body: string, script = "") => `<script>
  export let kind = "a";
  ${script}
</script>
{#if kind === "a"}<i>A</i>{:else}<b>B</b>{/if}
${body}`;

const SYNTAX: Record<string, string> = {
  "$state.raw and $derived.by": runes(
    "<p>{list.length} {label}</p>",
    "let list = $state.raw([1, 2]);\n  let label = $derived.by(() => kind + list.length);",
  ),
  "$effect, $inspect and $props.id": runes(
    "<p id={id}>{kind}</p>",
    "const id = $props.id();\n  $effect(() => { console.log(kind); });\n  $inspect(kind);",
  ),
  "{@attach}": runes(
    "<div {@attach (node) => { node.dataset.kind = kind; }}>x</div>",
  ),
  "<svelte:boundary>": runes(
    "<svelte:boundary><p>{kind}</p>{#snippet failed(error)}<p>failed</p>{/snippet}</svelte:boundary>",
  ),
  "class as an array and an object": runes(
    '<p class={["x", kind === "a" && "is-a", { "is-b": kind === "b" }]}>c</p>',
  ),
  "{#each} without `as`": runes(
    "{#each { length: kind === 'a' ? 1 : 2 }}<span>*</span>{/each}",
  ),
  "<svelte:head>, <svelte:window>, <svelte:document> and <svelte:body>": runes(
    "<svelte:head><title>{kind}</title></svelte:head><svelte:window onresize={() => {}} /><svelte:document onclick={() => {}} /><svelte:body onkeydown={() => {}} />",
  ),
  generics: runes(
    "<p>{items.length}</p>",
    "const items: T[] = [];",
    ' lang="ts" generics="T extends string"',
  ),
  "<script module>": `<script module>
  export const KINDS = ["a", "b"];
</script>
${runes("<p>{KINDS.join()}</p>")}`,
  "use:, transition: and animate:": legacy(
    '{#each [kind] as k (k)}<p use:act={kind} transition:fade={{ duration: kind === "a" ? 1 : 2 }} animate:flip>{k}</p>{/each}',
    'import { fade } from "svelte/transition";\n  import { flip } from "svelte/animate";\n  const act = () => {};',
  ),
  "<svelte:element>": runes(
    '<svelte:element this={kind === "a" ? "em" : "strong"}>e</svelte:element>',
  ),
  "{#key} and {@html}": runes(
    '{#key kind}<p>{@html kind === "a" ? "<u>a</u>" : "<s>b</s>"}</p>{/key}',
  ),
  createEventDispatcher: legacy(
    "<button on:click={() => dispatch(kind)}>d</button>",
    'import { createEventDispatcher } from "svelte";\n  const dispatch = createEventDispatcher();',
  ),
  "<svelte:options>": `<svelte:options immutable />
${legacy("<p>{kind}</p>")}`,
  "<svelte:fragment slot>": legacy('<div><slot name="title" /></div>'),
};

describe("syntax around a rewrite", () => {
  const shape = (component: string): LibraryApp => ({
    lib: { "Syntax.svelte": component },
    app: appRendering(
      '<Syntax kind="b" /><Syntax kind="b"><svelte:fragment slot="title">t</svelte:fragment></Syntax>',
    ),
  });
  const cases = Object.keys(SYNTAX).flatMap((name): [string, boolean][] => [
    [name, false],
    [name, true],
  ]);
  test.each(cases)("%s (unwrap: %p)", async (name, unwrap) => {
    const { before, after, edits } = await renderSpecialized(
      shape(SYNTAX[name]),
      { unwrap },
    );
    expect(after).toBe(before);
    expect(edits).toBeGreaterThan(0);
  });
});

describe("writes a rewrite keeps", () => {
  const WRITES: Record<string, string> = {
    "in $effect": runes("", '$effect(() => { kind = "a"; });'),
    "in $effect.pre": runes("", '$effect.pre(() => { kind = "a"; });'),
    "in {@attach}": runes('<div {@attach () => { kind = "a"; }}>x</div>'),
    "in an action's argument": runes(
      '<div use:act={() => (kind = "a")}>x</div>',
      "const act = () => {};",
    ),
    "by bind:value": runes("<input bind:value={kind} />"),
    "by a function binding": runes(
      "<input bind:value={() => kind, (value) => (kind = value)} />",
    ),
    "in an event attribute": runes(
      '<button onclick={() => (kind = "a")}>a</button>',
    ),
  };
  test.each(Object.keys(WRITES))("%s", async (name) => {
    const sources = await specializedLibrary({
      lib: { "Syntax.svelte": WRITES[name] },
      app: appRendering('<Syntax kind="b" />'),
    });
    const code = sources["Syntax.svelte"] ?? WRITES[name];
    expect(code).toContain("<i>A</i>");
    expect(code).toContain("<b>B</b>");
  });
});

test("`await` in markup is rewritten around", async () => {
  // Rendering it needs `experimental.async`; only the rewrite is checked.
  const sources = await specializedLibrary({
    lib: {
      "Syntax.svelte": runes(
        "<p>{await load(kind)}</p>",
        "const load = async (k) => k;",
      ),
    },
    app: appRendering('<Syntax kind="b" />'),
  });
  expect(sources["Syntax.svelte"]).toContain('{await load("b")}');
  expect(sources["Syntax.svelte"]).not.toContain("<i>A</i>");
});

// What a library's barrel exports: `export *`, namespaces, components with
// members, and values. One the analysis can't tell keeps every component.

const KIND = `<script>
  export let kind = "a";
</script>
{#if kind === "b"}<b>B</b>{:else}<i>A</i>{/if}`;

const BARREL_LIBRARY = {
  "index.js": `export { default as Outer } from "./Outer.svelte";
export * from "./parts/index.js";
export * from "./parts/index.js";
export * as Parts from "./parts/index.js";
export { Card } from "./card.js";
export * from "./Sizes.svelte";
export { cn, pick } from "./helpers.js";
export { default as Uses } from "./Uses.svelte";`,
  "parts/index.js": 'export { default as Inner } from "./Inner.svelte";',
  "parts/Inner.svelte": KIND,
  "Outer.svelte": `<script>
  import Inner from "./parts/Inner.svelte";
</script>
<Inner kind="a" />`,
  "card.js": `import Root from "./Root.svelte";
import Item from "./parts/Inner.svelte";
export const Card = Object.assign(Root, { Item });`,
  "Root.svelte": "<div><slot /></div>",
  "Sizes.svelte": `<script module>
  export const SIZES = ["sm", "md"];
</script>`,
  "Uses.svelte": `<script>
  import { Parts, Card } from "./index.js";
</script>
<Parts.Inner kind="b" />
<Card><Card.Item kind="b" /></Card>`,
  "helpers.js": `import Inner from "./parts/Inner.svelte";
export function cn(...parts) {
  return parts.join(" ");
}
export function pick() {
  return Inner;
}`,
};

const barrel = (markup: string, script = ""): LibraryApp => ({
  lib: BARREL_LIBRARY,
  app: appRendering(markup, script),
});

test.each([false, true])(
  "reads a prop `export { … as … }` renames (unwrap: %p)",
  async (unwrap) => {
    const shape: LibraryApp = {
      lib: {
        "Label.svelte": `<script>
  export let fore = null;
  export { fore as for };
</script>
<label for={fore}>{#if fore}<b>for</b>{:else}<i>none</i>{/if}</label>`,
      },
      app: appRendering('<Label for="e" />'),
    };
    const { before, after } = await renderSpecialized(shape, { unwrap });
    expect(after).toBe(before);
  },
);

describe("barrels", () => {
  const RENDER: Record<string, LibraryApp> = {
    "`export *`": barrel("<Outer /><Inner kind='b' />"),
    "a namespace re-export": barrel("<Outer /><Parts.Inner kind='b' />"),
    "a component with members": barrel(
      "<Outer /><Card><Card.Item kind='b' /></Card>",
    ),
    "the library's own imports of those": barrel("<Uses /><Inner />"),
    "a value it exports": barrel(
      "<Inner kind='b' />{SIZES.length}{cn('x')}",
      'import { SIZES, cn } from "mylib";',
    ),
  };
  const cases = Object.keys(RENDER).flatMap((name): [string, boolean][] => [
    [name, false],
    [name, true],
  ]);
  test.each(cases)(
    "%s renders as the original (unwrap: %p)",
    async (name, unwrap) => {
      const { before, after } = await renderSpecialized(RENDER[name], {
        unwrap,
      });
      expect(after).toBe(before);
    },
  );

  test.each([
    ["`export *`", "<Inner kind='b' />"],
    ["a namespace re-export", "<Parts.Inner kind='b' />"],
    ["a component with members", "<Card><Card.Item kind='b' /></Card>"],
  ])("reads a call site through %s", async (_, markup) => {
    const sources = await specializedLibrary(barrel(markup));
    expect(sources["parts/Inner.svelte"]).not.toContain("<i>A</i>");
  });

  test("reads the library's own call sites through them", async () => {
    const sources = await specializedLibrary(barrel("<Uses />"));
    expect(sources["parts/Inner.svelte"]).not.toContain("<i>A</i>");
  });

  test("a value it exports leaves the rest rewritten", async () => {
    const sources = await specializedLibrary(
      barrel("<Inner kind='b' />{cn('x')}", 'import { cn } from "mylib";'),
    );
    expect(sources["parts/Inner.svelte"]).not.toContain("<i>A</i>");
  });

  test("an export that may hold a component keeps every one", async () => {
    const sources = await specializedLibrary(
      barrel(
        "<Inner kind='b' /><svelte:component this={pick()} />",
        'import { pick } from "mylib";',
      ),
    );
    expect(sources["parts/Inner.svelte"] ?? KIND).toContain("<i>A</i>");
  });
});
