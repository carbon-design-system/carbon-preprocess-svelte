<script>
  /**
   * File tabs for a code view's header: one tab per file, styled like
   * LangSwitch (Carbon line tabs: a 2px `interactive-04` bar under the
   * selected file) and laid out from the header's left edge.
   *
   * Semantics: the ARIA tabs pattern with automatic activation. Tab enters
   * on the selected file; arrow keys move and select, Home/End jump to the
   * ends. Each tab controls `panel`.
   *
   * Overflow, as Carbon's Tabs: the list scrolls sideways, a chevron button
   * over a fade marks each side with more (pointer only; keyboard users
   * arrow through the tabs), and the selected tab stays in view. A path's
   * directory is muted, so the file names scan.
   */
  import { createEventDispatcher, onMount, tick } from "svelte";
  import ChevronLeft from "carbon-icons-svelte/lib/ChevronLeft.svelte";
  import ChevronRight from "carbon-icons-svelte/lib/ChevronRight.svelte";

  /** File names. */
  export let names = [];
  /** An icon component per file, optional. */
  export let icons = [];
  /** The selected index. */
  export let selected = 0;
  /** The id of the element the tabs control. */
  export let panel;
  /** Prefix for tab ids. */
  export let id;
  /** Accessible name for the tab list. */
  export let label = "Files";

  const dispatch = createEventDispatcher();
  let tabs = [];
  let list;
  let moreBefore = false;
  let moreAfter = false;
  // The overflow buttons' width: a tab under one counts as hidden.
  const EDGE = 32;

  function update() {
    if (!list) return;
    moreBefore = list.scrollLeft > 1;
    moreAfter = list.scrollLeft + list.clientWidth < list.scrollWidth - 1;
  }

  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** Scroll the list so a tab is fully visible, clear of the edge buttons. */
  function reveal(index) {
    const tab = tabs[index];
    if (!list || !tab) return;
    // Positions within the scrolled content.
    const left = tab.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft;
    const right = left + tab.offsetWidth;
    // At once: the selection moved, so the view should be there already.
    if (left < list.scrollLeft + (left > 0 ? EDGE : 0)) {
      list.scrollLeft = Math.max(0, left - EDGE);
    } else if (right > list.scrollLeft + list.clientWidth - EDGE) {
      list.scrollLeft = right - list.clientWidth + EDGE;
    }
  }

  function page(direction) {
    list.scrollBy({ left: direction * list.clientWidth * 0.8, behavior: reduceMotion() ? "auto" : "smooth" });
  }

  async function select(index, focus = false) {
    if (focus) tabs[index]?.focus({ preventScroll: true });
    reveal(index);
    if (index === selected) return;
    selected = index;
    dispatch("change", index);
  }

  onMount(() => {
    // The header's controls change with the file (a JS/TS switch comes and
    // goes), narrowing the list: keep the selected tab in view.
    const observer = new ResizeObserver(() => {
      reveal(selected);
      update();
    });
    observer.observe(list);
    tick().then(() => reveal(selected));
    return () => observer.disconnect();
  });

  /** `src/lib/regions.js` -> `["src/lib/", "regions.js"]`. */
  const split = (name) => {
    const slash = name.lastIndexOf("/") + 1;
    return [name.slice(0, slash), name.slice(slash)];
  };

  function onKeydown(event, index) {
    const last = names.length - 1;
    const target =
      event.key === "ArrowRight"
        ? (index + 1) % names.length
        : event.key === "ArrowLeft"
          ? (index - 1 + names.length) % names.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    if (target < 0) return;
    event.preventDefault();
    select(target, true);
  }
</script>

<div class="file-tabs" class:overflowing={moreBefore || moreAfter}>
  {#if moreBefore}
    <button class="edge before" type="button" tabindex="-1" aria-hidden="true" on:click={() => page(-1)}>
      <ChevronLeft />
    </button>
  {/if}
  <div class="list" role="tablist" aria-label={label} bind:this={list} on:scroll={update}>
    {#each names as name, index (name)}
      {@const [dir, base] = split(name)}
      <button
        bind:this={tabs[index]}
        id="{id}-{index}"
        type="button"
        role="tab"
        aria-selected={index === selected}
        aria-controls={panel}
        tabindex={index === selected ? 0 : -1}
        on:click={() => select(index)}
        on:keydown={(event) => onKeydown(event, index)}
      >
        {#if icons?.[index]}<svelte:component this={icons[index]} class="icon" />{/if}<span
          >{#if dir}<span class="dir">{dir}</span>{/if}{base}</span
        >
      </button>
    {/each}
  </div>
  {#if moreAfter}
    <button class="edge after" type="button" tabindex="-1" aria-hidden="true" on:click={() => page(1)}>
      <ChevronRight />
    </button>
  {/if}
</div>
<!-- Scrolling tabs end at a divider, so the edge button doesn't run into the controls. -->
{#if moreBefore || moreAfter}<span class="divider" aria-hidden="true"></span>{/if}

<style>
  .file-tabs {
    position: relative;
    display: flex;
    min-width: 0;
    height: 2.5rem;
    margin-inline-end: auto;
  }

  .list {
    display: flex;
    min-width: 0;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }

  .list::-webkit-scrollbar {
    display: none;
  }

  /* Overflow buttons over a fade, as Carbon's Tabs. */
  .edge {
    position: absolute;
    z-index: 1;
    top: 0;
    bottom: 0;
    display: flex;
    width: 2rem;
    min-width: 0;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--cds-icon-01, var(--cds-text-01));
    fill: currentColor;
  }

  .edge.before {
    left: 0;
    background: linear-gradient(to right, var(--cds-ui-01) 65%, transparent);
  }

  .divider {
    flex: none;
    width: 1px;
    height: 1rem;
    margin-inline: var(--cds-spacing-03);
    background-color: var(--cds-ui-03);
  }

  .file-tabs.overflowing {
    margin-inline-end: 0;
  }

  .edge.after {
    right: 0;
    background: linear-gradient(to left, var(--cds-ui-01) 65%, transparent);
  }

  .edge::after {
    content: none;
  }

  .edge:hover {
    background-color: var(--cds-hover-ui);
  }

  .dir {
    color: var(--cds-text-helper);
    font-weight: 400;
  }

  button {
    position: relative;
    flex: none;
    padding: 0 var(--cds-spacing-05);
    border: 0;
    background: transparent;
    color: var(--cds-text-02);
    cursor: pointer;
    font-family: "IBM Plex Mono", "Menlo", "DejaVu Sans Mono", monospace;
    font-size: 0.75rem;
    letter-spacing: 0.32px;
    line-height: 1;
    white-space: nowrap;
    transition:
      background-color 70ms cubic-bezier(0.2, 0, 0.38, 0.9),
      color 70ms cubic-bezier(0.2, 0, 0.38, 0.9);
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: var(--cds-spacing-03);
  }

  button :global(.icon) {
    flex: none;
    fill: currentColor;
  }

  button::after {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 2px;
    background-color: transparent;
    content: "";
  }

  button:hover {
    background-color: var(--cds-hover-ui);
    color: var(--cds-text-01);
  }

  button[aria-selected="true"] {
    color: var(--cds-text-01);
    font-weight: 600;
  }

  button[aria-selected="true"]::after {
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
    button {
      transition: none;
    }
  }

  @media (forced-colors: active) {
    button[aria-selected="true"] {
      text-decoration: underline;
      text-underline-offset: 6px;
    }
  }
</style>
