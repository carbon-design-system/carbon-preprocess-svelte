<script>
  // A wrapper, as apps write them: `optimizeComponents` follows `primary`
  // from each call site into the Button it renders.
  import { Button } from "carbon-components-svelte";

  /** The main action of its group, or a secondary one. */
  export let primary = false;
</script>

<Button
  kind={primary ? "tertiary" : "ghost"}
  size={primary ? undefined : "small"}
  on:click
>
  <slot />
</Button>
