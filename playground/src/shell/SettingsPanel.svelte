<script>
  /**
   * The settings panel: every option from `options.js`, grouped, as Carbon
   * controls. Selects for long lists, a content switcher for two to four
   * values, a toggle for on/off. Emits `change` with `{ key, value }` and
   * `reset`.
   *
   * It follows the page's theme, as the UI Shell's header does.
   */
  import { createEventDispatcher } from "svelte";
  import { Button, ContentSwitcher, Select, SelectItem, Switch, Toggle } from "carbon-components-svelte";
  import Reset from "carbon-icons-svelte/lib/Reset.svelte";
  import { DEFAULTS, GROUPS, OPTIONS } from "./options.js";

  /** The current options. */
  export let state;
  /** Whether the CCS in use has Prose (else Prose's options are off). */
  export let hasProse = true;

  const dispatch = createEventDispatcher();
  const set = (key, value) => value !== state[key] && dispatch("change", { key, value });

  $: changed = OPTIONS.some((o) => state[o.key] !== DEFAULTS[o.key]);
  const disabledOf = (option) => option.prose && !hasProse;
  const idOf = (key) => `setting-${key}`;
</script>

<div class="settings">
  <div class="head">
    <h2 class="bx--type-productive-heading-02">Settings</h2>
    <Button kind="ghost" size="small" icon={Reset} disabled={!changed} on:click={() => dispatch("reset")}>Reset all</Button>
  </div>

  {#each GROUPS as group (group.id)}
    {@const options = OPTIONS.filter((o) => o.group === group.id)}
    <section aria-labelledby="group-{group.id}">
      <h3 id="group-{group.id}" class="bx--type-label-01 group">{group.label}</h3>
      {#if group.id === "prose" && !hasProse}
        <p class="help">Off: the carbon-components-svelte in use has no Prose.</p>
      {:else if group.help}
        <p class="help">{group.help}</p>
      {/if}

      {#each options as option (option.key)}
        <div class="field">
          {#if option.control === "toggle"}
            <Toggle
              size="sm"
              id={idOf(option.key)}
              labelText={option.label}
              labelA="Off"
              labelB="On"
              toggled={state[option.key] === "1"}
              disabled={disabledOf(option)}
              on:toggle={(e) => set(option.key, e.detail.toggled ? "1" : "0")}
            />
          {:else if option.control === "switch"}
            <span id={idOf(option.key)} class="bx--label">{option.label}</span>
            <ContentSwitcher
              size="sm"
              aria-labelledby={idOf(option.key)}
              selectedIndex={Math.max(0, option.values.findIndex(([v]) => v === state[option.key]))}
              on:change={(e) => set(option.key, option.values[e.detail][0])}
            >
              {#each option.values as [, text]}
                <Switch {text} disabled={disabledOf(option)} />
              {/each}
            </ContentSwitcher>
          {:else}
            <Select
              size="sm"
              id={idOf(option.key)}
              labelText={option.label}
              selected={state[option.key]}
              disabled={disabledOf(option)}
              on:update={(e) => set(option.key, e.detail)}
            >
              {#each option.values as [value, text]}
                <SelectItem {value} {text} />
              {/each}
            </Select>
          {/if}
          {#if option.help}<p class="help field-help">{option.help}</p>{/if}
        </div>
      {/each}
    </section>
  {/each}
  <p class="help foot">Settings live in the URL: copy it to share this view.</p>
</div>

<style>
  .settings {
    display: flex;
    min-height: 100%;
    flex-direction: column;
    gap: var(--cds-spacing-06);
    padding: var(--cds-spacing-05);
    background-color: var(--cds-ui-background);
    color: var(--cds-text-01);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: var(--cds-spacing-05);
    padding-top: var(--cds-spacing-05);
    border-top: 1px solid var(--cds-ui-03);
  }

  .group {
    margin: 0;
    color: var(--cds-text-01);
    font-weight: 600;
  }

  .help {
    margin: calc(-1 * var(--cds-spacing-03)) 0 0;
    color: var(--cds-text-helper);
    font-size: 0.75rem;
    line-height: 1.34;
  }

  .field {
    display: flex;
    flex-direction: column;
  }

  .field-help {
    margin-top: var(--cds-spacing-02);
  }

  .foot {
    margin-top: auto;
  }

  /* A label above a content switcher, spaced as Carbon spaces a field's. */
  .field :global(.bx--label) {
    margin-bottom: var(--cds-spacing-03);
  }
</style>
