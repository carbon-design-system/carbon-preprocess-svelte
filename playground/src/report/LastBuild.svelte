<script>
  /** This playground's last `vite build`: what the optimizers did, and the largest assets. */
  import { DataTable, InlineNotification, Tile } from "carbon-components-svelte";
  import report from "virtual:build-report";

  const build = report.lastBuild;
  const kb = (value) => `${value.toFixed(1)} kB`;
  const css = build?.css.find((c) => c.file.startsWith("index")) ?? build?.css[0];
</script>

{#if !build}
  <InlineNotification
    kind="info"
    lowContrast
    hideCloseButton
    title="No build yet."
    subtitle="Run bunx vite build in playground/ (or bun run test:playground), then reload."
  />
{:else}
  <p class="when bx--type-helper-text-01">
    {new Date(build.at).toLocaleString()}, against the {build.ccs} CCS{build.optimized
      ? ""
      : ", with the optimizers off (a checkout build: see CONTRIBUTING.md)"}.
  </p>
  <div class="tiles">
    <Tile>
      <p class="bx--type-label-01">optimizeCss</p>
      <p class="figure">{css ? `${css.before} → ${css.after}` : "Off"}</p>
      {#if css}<p class="bx--type-helper-text-01">{css.percent}% smaller</p>{/if}
    </Tile>
    <Tile>
      <p class="bx--type-label-01">optimizeComponents</p>
      <p class="figure">{build.components ? `${build.components.rewritten} components` : "Off"}</p>
      {#if build.components}<p class="bx--type-helper-text-01">{build.components.edits} edits</p>{/if}
    </Tile>
    <Tile>
      <p class="bx--type-label-01">Output</p>
      <p class="figure">{kb(build.totals.js + build.totals.css)}</p>
      <p class="bx--type-helper-text-01">{kb(build.totals.js)} JS, {kb(build.totals.css)} CSS, {build.totals.files} files</p>
    </Tile>
  </div>
  <DataTable
    size="compact"
    sortable
    headers={[
      { key: "file", value: "Largest files" },
      { key: "type", value: "Type" },
      { key: "kb", value: "Size (kB)" },
    ]}
    rows={build.assets.map((a) => ({ id: a.file, ...a }))}
  />
{/if}

<style>
  .when {
    margin-bottom: var(--cds-spacing-05);
    color: var(--cds-text-02);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 1px;
    margin-bottom: var(--cds-spacing-06);
  }

  .figure {
    margin: var(--cds-spacing-03) 0 var(--cds-spacing-02);
    font-size: 1.25rem;
    font-variant-numeric: tabular-nums;
  }
</style>
