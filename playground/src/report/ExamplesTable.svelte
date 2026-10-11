<script>
  /** Every example's CSS before and after `optimizeCss`, from the e2e snapshot. */
  import { DataTable, ProgressBar } from "carbon-components-svelte";
  import report from "virtual:build-report";

  const headers = [
    { key: "example", value: "Example" },
    { key: "build", value: "Build" },
    { key: "before_kb", value: "Before (kB)" },
    { key: "after_kb", value: "After (kB)" },
    { key: "reduction_percent", value: "Smaller by" },
  ];
  // The snapshot's names for each example's builds (an example with one
  // build is as its config sets up; vite@svelte-5 builds one per component).
  const BUILDS = {
    default: "optimizeCss",
    css: "optimizeCss",
    "prop-aware": "optimizeCss, prop-aware",
    optimized: "+ optimizeComponents",
    full: "+ optimizeComponents",
  };
  const rows = report.examples.map((e) => ({
    id: `${e.example}:${e.build}`,
    ...e,
    build: e.flat ? "As configured" : (BUILDS[e.build] ?? e.build),
  }));
</script>

<div class="table">
  <DataTable size="compact" sortable {headers} {rows}>
    <svelte:fragment slot="cell" let:cell>
      {#if cell.key === "reduction_percent"}
        <div class="bar">
          <ProgressBar size="sm" value={cell.value} max={100} hideLabel labelText="Smaller by" />
          <span>{cell.value.toFixed(1)}%</span>
        </div>
      {:else}
        {cell.value}
      {/if}
    </svelte:fragment>
  </DataTable>
</div>

<style>
  .table :global(table) {
    table-layout: fixed;
  }

  .bar {
    display: grid;
    grid-template-columns: 1fr 3.5rem;
    align-items: center;
    gap: var(--cds-spacing-03);
    font-variant-numeric: tabular-nums;
    text-align: end;
  }
</style>
