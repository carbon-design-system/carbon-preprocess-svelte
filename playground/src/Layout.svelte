<script>
  import { Column, Content, Grid, Link, Row } from "carbon-components-svelte";

  export let title = "";
  export let description = "";
  export let headings = [];

  $: toc = headings.filter((h) => h.depth === 2 || h.depth === 3);
</script>

<Content>
  <Grid>
    <Row>
      <Column lg={12} md={6}>
        <h1 class="bx--type-productive-heading-06">{title}</h1>
        <p class="bx--type-body-long-02 intro">{description}</p>
        <slot />
      </Column>
      <Column lg={4} md={2} sm={0}>
        <nav class="toc" aria-label="On this page">
          <p class="bx--type-label-01">On this page</p>
          {#each toc as h (h.id)}
            <Link href="#{h.id}" class={h.depth === 3 ? "sub" : ""}>{h.text}</Link>
          {/each}
        </nav>
      </Column>
    </Row>
  </Grid>
</Content>

<style>
  .intro {
    max-width: 68ch;
    margin: var(--cds-spacing-05) 0 var(--cds-spacing-07);
    color: var(--cds-text-02);
  }

  .toc {
    position: sticky;
    top: var(--cds-spacing-07);
    display: flex;
    flex-direction: column;
    gap: var(--cds-spacing-03);
  }

  .toc :global(.sub) {
    padding-inline-start: var(--cds-spacing-05);
  }
</style>
