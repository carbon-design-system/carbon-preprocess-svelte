<script>
  import { InlineNotification } from "carbon-components-svelte";

  /** `info` or `warning`. */
  export let kind = "info";

  export let title;
</script>

<InlineNotification
  {kind}
  {title}
  lowContrast
  hideCloseButton
>
  <div slot="subtitle"><slot /></div>
</InlineNotification>
