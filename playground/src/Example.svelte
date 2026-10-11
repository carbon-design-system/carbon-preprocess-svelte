<script>
  /**
   * Stands in for the CCS docs' Preview: a live-example region and its code
   * view. The live example mounts when it nears the viewport (`?lazy=0`
   * mounts it at once); until then a placeholder holds its place.
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
  let mounted = !$perf.lazy;

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
    <div class="example" bind:this={region}>
      {#if mounted}<slot />{:else}<div class="pending" aria-busy="true"></div>{/if}
    </div>
  {/if}
  {#if files}<CodeView {files} {icons} playground />{:else if code}<CodeView {code} {views} {icon} lang="svelte" playground />{/if}
</div>

<style>
  /* About one row of controls, so most examples barely move when they mount. */
  .pending {
    min-height: 3rem;
  }

  .preview > :global(.example + .codeview) {
    border-top: 0;
  }
</style>
