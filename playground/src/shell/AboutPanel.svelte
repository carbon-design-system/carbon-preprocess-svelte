<script>
  /**
   * What the playground is running on: the carbon-components-svelte in use
   * and whether it has Prose, the pages, and where to read more.
   */
  import { Link, Tag } from "carbon-components-svelte";

  /** `{ prose, ccs }`, from the build (`__PLAYGROUND__`). */
  export let build;
  /** How many pages, and how many from a CCS checkout. */
  export let pages = 0;
  export let ccsPages = 0;
</script>

<div class="about">
  <h2 class="bx--type-productive-heading-02">About this build</h2>
  <dl>
    <dt class="bx--label">carbon-components-svelte</dt>
    <dd><code>{build.ccs}</code></dd>
    <dt class="bx--label">Prose</dt>
    <dd>
      {#if build.prose}<Tag size="sm" type="green">Available</Tag>{:else}<Tag size="sm" type="warm-gray">Not in this version</Tag>{/if}
    </dd>
    <dt class="bx--label">Pages</dt>
    <dd>{ccsPages ? `${pages}, ${ccsPages} from the CCS checkout` : pages}</dd>
  </dl>
  <p class="help">
    The playground builds with carbon-preprocess-svelte from this repo: <code>markdown()</code>,
    <code>optimizeImports()</code>, <code>optimizeCss()</code>, and code views on
    <code>carbon-preprocess-svelte/code</code>.
  </p>
  <p class="help">
    To use a checkout (for Prose): <code>CCS_DIR=…</code> in <code>playground/.env.local</code>, then
    restart. Tests: <code>bun run test:playground</code>.
  </p>
  <Link
    href="https://github.com/carbon-design-system/carbon-preprocess-svelte/tree/main/playground"
    target="_blank"
    rel="noreferrer">Playground README</Link
  >
</div>

<style>
  .about {
    display: flex;
    min-height: 100%;
    flex-direction: column;
    gap: var(--cds-spacing-05);
    padding: var(--cds-spacing-05);
    background-color: var(--cds-ui-background);
    color: var(--cds-text-01);
  }

  dl {
    display: grid;
    gap: var(--cds-spacing-02) 0;
  }

  dt {
    margin-top: var(--cds-spacing-03);
  }

  dd {
    font-size: 0.875rem;
    overflow-wrap: anywhere;
  }

  code {
    font-family: "IBM Plex Mono", monospace;
    font-size: 0.75rem;
  }

  .help {
    color: var(--cds-text-02);
    font-size: 0.875rem;
    line-height: 1.43;
  }
</style>
