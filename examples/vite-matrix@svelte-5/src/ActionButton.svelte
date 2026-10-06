<script>
  // A wrapper, as apps write them: `optimizeComponents` follows `primary`
  // from each call site into the Button it renders.
  import { Button } from "carbon-components-svelte";

  /** `primary`: the main action of its group, or a secondary one. */
  let { primary = false, onclick = undefined, children } = $props();
</script>

<Button
  kind={primary ? "tertiary" : "ghost"}
  size={primary ? undefined : "small"}
  {onclick}
>
  {@render children?.()}
</Button>
