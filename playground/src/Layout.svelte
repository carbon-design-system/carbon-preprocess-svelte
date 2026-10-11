<script>
  // A docs page: the title, the description, the page, and its table of
  // contents. The shell (App.svelte) provides Carbon's `Content`.
  import { Column, Grid, Link, Row } from "carbon-components-svelte";

  export let title = "";
  export let description = "";
  export let headings = [];
  /** The full width, without a table of contents (frontmatter `wide: true`). */
  export let wide = false;

  $: toc = headings.filter((h) => h.depth === 2 || h.depth === 3);
</script>

<Grid>
  <Row>
    <Column lg={wide ? 16 : 12} md={wide ? 8 : 6}>
      <header>
        <h1 class="bx--type-productive-heading-06">{title}</h1>
        {#if description}<p class="bx--type-body-long-02 intro">{description}</p>{/if}
      </header>
      <slot />
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
