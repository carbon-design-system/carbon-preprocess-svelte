<script>
  // Every element group × one option per column, optionally repeated per
  // value of a second option. All other options come from the toolbar.

  /** Option name -> [value, label][] */
  export let selects;
  /** The toolbar's values, used for options not on an axis. */
  export let state;
  export let columns = "variant";
  export let group = "theme";

  const samples = Object.entries(import.meta.glob("./samples/*.sample", { eager: true }))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, mod]) => [path.split("/").pop().replace(/^\d+-|\.sample$/g, "").replace(/-/g, " "), mod.default]);

  // Each cell carries its own theme (`.t-<theme>`): see theme-scopes.js.
  import { themeScopeCss as themeCss } from "./theme-scopes.js";

  const valuesOf = (name) =>
    name === "none" ? [[null, ""]] : selects[name].filter(([v]) => v !== "system");

  $: cellOf = (g, c) => {
    const cell = { ...state, theme: state.theme === "system" ? "white" : state.theme };
    if (group !== "none") cell[group] = g;
    cell[columns] = c;
    return cell;
  };
  const classOf = (cell) =>
    ["cell", `t-${cell.theme}`, cell.syntax === "build" && "syntax-build"].filter(Boolean).join(" ");
  const proseOf = (cell) => ({
    ...(cell.variant !== "auto" && { variant: cell.variant }),
    maxWidth: cell.measure === "auto" ? "none" : cell.measure,
    linkTone: cell.linkTone,
    tableWidth: cell.tableWidth,
    kbd: cell.kbd,
    dividers: cell.dividers === "1",
  });
</script>

<svelte:head>
  {@html `<style>${themeCss}</style>`}
</svelte:head>

<div class="matrix-page">
  <p class="hint">
    Rows: element groups. Columns: <strong>{columns}</strong>{group !== "none" ? `, repeated per ${group}` : ""}.
    Other options come from the toolbar. Heading anchors are shown at full opacity; the
    "Hover", "Focus", and "Visited" links are forced states.
  </p>

  {#each valuesOf(group) as [g, gLabel]}
    {#if group !== "none"}<h2 class="group">{gLabel}</h2>{/if}
    <div class="matrix" style="grid-template-columns: 8rem repeat({valuesOf(columns).length}, minmax(17rem, 1fr))">
      <div></div>
      {#each valuesOf(columns) as [, cLabel]}
        <div class="col-head">{cLabel}</div>
      {/each}
      {#each samples as [name, Sample]}
        <div class="row-head">{name}</div>
        {#each valuesOf(columns) as [c]}
          {@const cell = cellOf(g, c)}
          <div class={classOf(cell)}>
            <Sample proseProps={proseOf(cell)} />
          </div>
        {/each}
      {/each}
    </div>
  {/each}
</div>

<style>
  .matrix-page {
    padding: var(--cds-spacing-05);
  }

  .hint {
    max-width: 90ch;
    margin-bottom: var(--cds-spacing-05);
    color: var(--cds-text-02);
    font-size: 0.875rem;
  }

  .group {
    margin: var(--cds-spacing-07) 0 var(--cds-spacing-04);
    font-size: 1.25rem;
  }

  .matrix {
    display: grid;
    gap: 1px;
    overflow-x: auto;
    border: 1px solid var(--cds-ui-03);
    background: var(--cds-ui-03);
  }

  .col-head,
  .row-head {
    padding: var(--cds-spacing-03);
    background: var(--cds-ui-01);
    color: var(--cds-text-02);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: capitalize;
  }

  .row-head {
    position: sticky;
    z-index: 1;
    left: 0;
  }

  .cell {
    min-width: 0;
    padding: var(--cds-spacing-05);
    background: var(--cds-ui-background);
    color: var(--cds-text-01);
  }

  .cell :global(.bx--prose__heading-anchor) {
    opacity: 1;
  }
</style>
