<script>
  /**
   * The options that differ from their defaults, as dismissible tags, so the
   * view's state is always visible: dismiss one to reset it, or all at once.
   */
  import { createEventDispatcher } from "svelte";
  import { Button, Tag } from "carbon-components-svelte";
  import { DEFAULTS, labelOf, OPTIONS } from "./options.js";

  export let state;

  const dispatch = createEventDispatcher();
  $: changed = OPTIONS.filter((o) => state[o.key] !== DEFAULTS[o.key]);
</script>

{#if changed.length}
  <div class="changed" role="region" aria-label="Changed settings">
    <span class="bx--label label">Changed</span>
    {#each changed as option (option.key)}
      <Tag
        size="sm"
        type="high-contrast"
        filter
        title="Reset {option.label}"
        on:close={() => dispatch("change", { key: option.key, value: option.default })}
      >
        {option.label}: {labelOf(option.key, state[option.key])}
      </Tag>
    {/each}
    {#if changed.length > 1}
      <Button kind="ghost" size="small" on:click={() => dispatch("reset")}>Reset all</Button>
    {/if}
  </div>
{/if}

<style>
  .changed {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--cds-spacing-02) var(--cds-spacing-03);
    padding: var(--cds-spacing-03) var(--cds-spacing-05);
    border-bottom: 1px solid var(--cds-ui-03);
    background-color: var(--cds-ui-01);
  }

  .label {
    margin: 0 var(--cds-spacing-02) 0 0;
  }

  /* Tags sit in a row: no stacked margins. */
  .changed :global(.bx--tag) {
    margin: 0;
  }
</style>
