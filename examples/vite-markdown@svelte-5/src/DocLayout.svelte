<script>
  import { Column, Content, Grid, Link, Row } from "carbon-components-svelte";

  /** From the page's frontmatter. */
  export let title = "";
  export let description = "";

  /**
   * Every heading on the page, exported by `markdown()` at build time.
   * @type {import("carbon-preprocess-svelte").MarkdownHeading[]}
   */
  export let headings = [];

  $: toc = headings.filter(
    (heading) => heading.depth === 2 || heading.depth === 3,
  );
</script>

<Content>
  <Grid>
    <Row>
      <Column
        lg={12}
        md={6}
      >
        <h1 class="bx--type-productive-heading-06">{title}</h1>
        <p class="bx--type-body-long-02 intro">{description}</p>
        <slot />
      </Column>
      <Column
        lg={4}
        md={2}
        sm={0}
      >
        <nav
          class="toc"
          aria-label="On this page"
        >
          <p class="bx--type-label-01">On this page</p>
          {#each toc as heading (heading.id)}
            <Link
              href="#{heading.id}"
              class={heading.depth === 3 ? "sub" : ""}
            >
              {heading.text}
            </Link>
          {/each}
        </nav>
      </Column>
    </Row>
  </Grid>
</Content>

<style>
  .intro {
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
