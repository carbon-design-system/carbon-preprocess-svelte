<script>
  /**
   * Stands in for the CCS docs' Preview: a live-example region and its code
   * view. The live example mounts when it nears the viewport (`?lazy=0`
   * mounts it at once); until then a placeholder holds its place.
   *
   * A live example taller than half the viewport (or 24rem) scrolls inside
   * its region, so its code stays in view. Only tall ones: a scroll container
   * would clip a short example's menus.
   */
  import { onMount } from "svelte";
  import CodeView from "./CodeView.svelte";
  import { perf } from "./settings.js";

  export let frame = "";
  /** The example's standalone source (from `ctx.example`, or the framed file). */
  export let code = "";
  /** A multi-file example: the example and the local modules it imports. */
  export let files = undefined;
  /** Build-time views for the code view. */
  export let views = undefined;
  /** The code view's icon, and icons for `files`. */
  export let icon = undefined;
  export let icons = undefined;

  let region;
  let body;
  let mounted = !$perf.lazy;
  let tall = false;

  // Matches `.example.tall`'s max-height.
  const cap = () =>
    Math.min(24 * parseFloat(getComputedStyle(document.documentElement).fontSize), innerHeight / 2);

  onMount(() => {
    if (!body) return;
    const observer = new ResizeObserver(() => (tall = body.offsetHeight > cap()));
    observer.observe(body);
    return () => observer.disconnect();
  });

  onMount(() => {
    if (mounted || !region) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        mounted = true;
        observer.disconnect();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(region);
    return () => observer.disconnect();
  });
</script>

<div class="preview">
  {#if frame}
    <div class="example frame"><span>Framed example: {frame}</span></div>
  {:else}
    <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
    <div
      class="example"
      class:tall
      bind:this={region}
      role={tall ? "region" : undefined}
      aria-label={tall ? "Live example" : undefined}
      tabindex={tall ? 0 : undefined}
    >
      <div bind:this={body}>
        {#if mounted}<slot />{:else}<div class="pending" aria-busy="true"></div>{/if}
      </div>
    </div>
  {/if}
  {#if files}<CodeView {files} {icons} playground />{:else if code}<CodeView {code} {views} {icon} lang="svelte" playground />{/if}
</div>

<style>
  /* About one row of controls, so most examples barely move when they mount. */
  .pending {
    min-height: 3rem;
  }

  /* Scrolls, so a keyboard can reach it (tabindex) and sees where it is. */
  .tall {
    max-height: min(24rem, 50vh);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .tall:focus-visible {
    outline: 2px solid var(--cds-focus);
    outline-offset: -2px;
  }

  .preview > :global(.example + .codeview) {
    border-top: 0;
  }
</style>
