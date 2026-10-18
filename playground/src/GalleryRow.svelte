<script>
  /**
   * An option's variants side by side, each in its own box under its value:
   * the options gallery (`gallery.ts`).
   */
  import { Column, Grid, Row } from "carbon-components-svelte";

  /** `{ label, component }[]`: the option's value, and the sample compiled with it. */
  export let items = [];
</script>

<Grid noGutter class="gallery-row">
  <Row>
    {#each items as { label, component } (label)}
      <Column sm={4} md={4} lg={16 / Math.min(items.length, 4)}>
        <figure>
          <figcaption><code>{label}</code></figcaption>
          <div class="variant"><svelte:component this={component} /></div>
        </figure>
      </Column>
    {/each}
  </Row>
</Grid>

<style>
  :global(.gallery-row) {
    margin-block: var(--cds-spacing-05) var(--cds-spacing-09);
  }

  figure {
    height: 100%;
    margin: 0 0 1px;
    border: 1px solid var(--cds-ui-03);
  }

  figcaption {
    padding: var(--cds-spacing-03) var(--cds-spacing-05);
    border-bottom: 1px solid var(--cds-ui-03);
    background: var(--cds-ui-01);
    color: var(--cds-text-02);
    font: 0.75rem/1.34 "IBM Plex Mono", monospace;
  }

  figcaption code {
    font: inherit;
  }

  .variant {
    padding: var(--cds-spacing-05);
  }
</style>
