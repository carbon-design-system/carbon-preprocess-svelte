<script>
  // A docs page: the title, the description, the page, and its table of
  // contents. The shell (App.svelte) provides Carbon's `Content`.
  import { getContext } from "svelte";
  import { get, writable } from "svelte/store";
  import { Column, ContentSwitcher, Grid, InlineLoading, Link, Row, Switch } from "carbon-components-svelte";
  import sources from "virtual:page-sources";
  import LogoSvelte from "carbon-icons-svelte/lib/LogoSvelte.svelte";
  import Markdown from "carbon-icons-svelte/lib/Markdown.svelte";
  import View from "carbon-icons-svelte/lib/View.svelte";
  import CodeView from "./CodeView.svelte";

  // The views, each with a small icon before its label (a Switch with an
  // `icon` would be icon-only).
  const VIEWS = [
    { text: "Page", icon: View },
    { text: "Markdown", icon: Markdown },
    { text: "Compiled", icon: LogoSvelte },
  ];

  export let title = "";
  export let description = "";
  export let headings = [];
  /** The full width, without a table of contents (frontmatter `wide: true`). */
  export let wide = false;

  $: toc = headings.filter((h) => h.depth === 2 || h.depth === 3);

  // The page as written, and as markdown() compiles it: loaded on first use.
  // Each page mounts afresh, so reading the current page once is enough.
  const page = get(getContext("playground:page") ?? writable(undefined));
  const loadSource = page && sources[page];
  let view = 0;
  let source;
  $: if (view > 0 && loadSource && !source) source = loadSource().then((m) => m.default);
</script>

<Grid>
  <Row>
    <Column lg={wide ? 16 : 12} md={wide ? 8 : 6}>
      <header>
        <h1 class="bx--type-productive-heading-06">{title}</h1>
        {#if description}<p class="bx--type-body-long-02 intro">{description}</p>{/if}
        {#if loadSource}
          <ContentSwitcher size="sm" lowContrast class="views" aria-label="View" bind:selectedIndex={view}>
            {#each VIEWS as { text, icon } (text)}
              <Switch {text}><span class="view"><svelte:component this={icon} />{text}</span></Switch>
            {/each}
          </ContentSwitcher>
        {/if}
      </header>
      {#if view > 0}
        {#await source}
          <InlineLoading description="Compiling…" />
        {:then { markdown, svelte }}
          {@const views = view === 1 ? markdown : svelte}
          {#key view}
            <CodeView
              code={views.source.code}
              {views}
              lang="svelte"
              meta={`title="${view === 1 ? `${page}.svx` : "Compiled by markdown()"}" showLineNumbers`}
              maxCollapsedLines={Infinity}
            />
          {/key}
        {/await}
      {/if}
      <!-- Hidden, not removed, so the page keeps its state. -->
      <div hidden={view > 0}><slot /></div>
    </Column>
    {#if !wide}
      <Column lg={4} md={2} sm={0}>
        {#if toc.length}
          <nav class="toc" aria-label="On this page">
            <p class="bx--type-label-01">On this page</p>
            {#each toc as h (h.id)}
              <Link href="#{h.id}" class={h.depth === 3 ? "sub" : ""}>{h.text}</Link>
            {/each}
          </nav>
        {/if}
      </Column>
    {/if}
  </Row>
</Grid>

<style>
  header {
    margin-bottom: var(--cds-spacing-07);
  }

  header :global(.views) {
    max-width: 27rem;
    margin-top: var(--cds-spacing-06);
  }

  .view {
    display: inline-flex;
    align-items: center;
    gap: var(--cds-spacing-03);
  }

  .view :global(svg) {
    flex: none;
    fill: currentColor;
  }

  .intro {
    max-width: 68ch;
    margin: var(--cds-spacing-05) 0 0;
    color: var(--cds-text-02);
  }

  .toc {
    position: sticky;
    /* Under the 48px header. */
    top: calc(3rem + var(--cds-spacing-07));
    display: flex;
    flex-direction: column;
    gap: var(--cds-spacing-03);
  }

  .toc :global(.sub) {
    padding-inline-start: var(--cds-spacing-05);
  }
</style>
