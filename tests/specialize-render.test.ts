import {
  appRendering,
  type LibraryApp,
  renderSpecialized,
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
