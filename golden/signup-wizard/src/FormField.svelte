<script>
  import { TextInput } from "carbon-components-svelte";
  import { FIELD_SIZE } from "./config.js";

  /** The field's label. */
  export let label;

  /** An error to show instead of the helper text. */
  export let error = "";

  export let helper = "";

  export let value = "";
</script>

<TextInput
  {...$$restProps}
  size={FIELD_SIZE}
  labelText={label}
  helperText={helper}
  invalid={error !== ""}
  invalidText={error}
  bind:value
/>
