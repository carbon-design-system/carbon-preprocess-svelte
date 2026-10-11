<script>
  import { ClickableTile } from "carbon-components-svelte";
  import { ArrowRight } from "./icons.js";

  export let title;
  export let href;
  export let summary = "";
  export let featured = false;
</script>

<ClickableTile
  {href}
  light={featured}
>
  <h3 class:featured>{title}</h3>
  {#if summary}
    <p>{summary}</p>
  {/if}
  <svelte:component this={ArrowRight} />
</ClickableTile>

<style>
  .featured {
    font-weight: 600;
  }
</style>
