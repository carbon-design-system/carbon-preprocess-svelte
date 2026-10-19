<script>
  /**
   * A language switch for a code snippet header (JS / TS, or npm / pnpm /
   * bun). Built to sit beside CodeSnippet's copy button: the same 40px
   * height, field hover, and inset focus ring, with the selected language
   * marked like a Carbon line tab (a 2px `interactive-04` bar and primary
   * text) rather than a filled pill.
   *
   * Semantics: a radio group. Tab enters on the selected option; arrow keys
   * move and select, Home/End jump to the ends.
   */
  import { createEventDispatcher } from "svelte";

  /** @type {{ value: string; label: string; title?: string }[]} */
  export let options = [];
  /** The selected option's value. */
  export let value = options[0]?.value;
  /** Accessible name for the group. */
  export let label = "Language";

  const dispatch = createEventDispatcher();
  let buttons = [];

  function select(next, focus = false) {
    if (next === value) return;
    value = next;
    dispatch("change", value);
    if (focus) buttons[options.findIndex((o) => o.value === next)]?.focus();
  }

  function onKeydown(event, index) {
    const last = options.length - 1;
    const target =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? (index + 1) % options.length
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? (index - 1 + options.length) % options.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    if (target < 0) return;
    event.preventDefault();
    select(options[target].value, true);
  }
</script>

<div class="lang-switch" role="radiogroup" aria-label={label}>
  {#each options as option, index (option.value)}
    <button
      bind:this={buttons[index]}
      type="button"
      role="radio"
      aria-checked={option.value === value}
      tabindex={option.value === value ? 0 : -1}
      title={option.title}
      on:click={() => select(option.value)}
      on:keydown={(event) => onKeydown(event, index)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .lang-switch {
    display: inline-flex;
    height: 2.5rem;
  }

  button {
    position: relative;
    min-width: 2.75rem;
    padding: 0 var(--cds-spacing-04);
    border: 0;
    background: transparent;
    color: var(--cds-text-02);
    cursor: pointer;
    font-family: "IBM Plex Mono", "Menlo", "DejaVu Sans Mono", monospace;
    font-size: 0.75rem;
    font-weight: 400;
    letter-spacing: 0.32px;
    line-height: 1;
    transition:
      background-color 70ms cubic-bezier(0.2, 0, 0.38, 0.9),
      color 70ms cubic-bezier(0.2, 0, 0.38, 0.9);
  }

  /* The selection bar: Carbon's line-tab indicator, inset from the edges. */
  button::after {
    position: absolute;
    right: var(--cds-spacing-04);
    bottom: 0;
    left: var(--cds-spacing-04);
    height: 2px;
    background-color: transparent;
    content: "";
    transition: background-color 70ms cubic-bezier(0.2, 0, 0.38, 0.9);
  }

  button:hover {
    background-color: var(--cds-hover-field, var(--cds-hover-ui));
    color: var(--cds-text-01);
  }

  button:active {
    background-color: var(--cds-active-ui);
  }

  button[aria-checked="true"] {
    color: var(--cds-text-01);
    font-weight: 600;
  }

  button[aria-checked="true"]::after {
    background-color: var(--cds-interactive-04);
  }

  button:focus {
    outline: none;
  }

  button:focus-visible {
    outline: 2px solid var(--cds-focus);
    outline-offset: -2px;
  }

  @media (prefers-reduced-motion: reduce) {
    button,
    button::after {
      transition: none;
    }
  }

  /* Windows high contrast drops backgrounds: underline the selection instead. */
  @media (forced-colors: active) {
    button[aria-checked="true"] {
      text-decoration: underline;
      text-underline-offset: 6px;
    }
  }
</style>
