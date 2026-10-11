<script>
  // Every element group × one option per column, optionally repeated per
  // value of a second option. All other options come from Settings.
  import { Select, SelectItem } from "carbon-components-svelte";

  /** Option name -> [value, label][] */
  export let selects;
  /** The options the Matrix can lay out (`axis` in options.js). */
  export let axes = [];
  /** The settings, used for options not on an axis. */
  export let state;
  export let columns = "variant";
  export let group = "none";

  const samples = Object.entries(import.meta.glob("./samples/*.sample", { eager: true }))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, mod]) => [path.split("/").pop().replace(/^\d+-|\.sample$/g, "").replace(/-/g, " "), mod.default]);

  // Each cell carries its own theme (`.t-<theme>`): see theme-scopes.js.
  import { themeScopeCss as themeCss } from "./theme-scopes.js";

  // Repeating per the column's own setting would show one cell per group.
  $: if (group === columns) group = "none";

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
  <header class="matrix-head">
    <div>
      <h1 class="bx--type-productive-heading-04">Matrix</h1>
      <p class="hint">
        Every element group, side by side across one setting. Other settings apply to every cell. Heading
        anchors are shown at full opacity, and the "Hover", "Focus", and "Visited" links are forced states.
      </p>
    </div>
    <div class="axes">
      <Select size="sm" inline labelText="Columns" bind:selected={columns}>
        {#each axes as axis (axis.key)}<SelectItem value={axis.key} text={axis.label} />{/each}
      </Select>
      <Select size="sm" inline labelText="Repeat per" bind:selected={group}>
        <SelectItem value="none" text="Nothing" />
        {#each axes.filter((a) => a.key !== columns) as axis (axis.key)}<SelectItem value={axis.key} text={axis.label} />{/each}
      </Select>
    </div>
  </header>

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
    padding-top: var(--cds-spacing-07);
  }

  .matrix-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--cds-spacing-05) var(--cds-spacing-07);
    margin-bottom: var(--cds-spacing-07);
  }

  .hint {
    max-width: 72ch;
    margin-top: var(--cds-spacing-03);
    color: var(--cds-text-02);
    font-size: 0.875rem;
    line-height: 1.43;
  }

  .axes {
    display: flex;
    flex-wrap: wrap;
    gap: var(--cds-spacing-05);
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
