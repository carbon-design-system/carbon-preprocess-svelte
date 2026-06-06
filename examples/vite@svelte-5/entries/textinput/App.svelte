<script lang="ts">
  import "carbon-components-svelte/css/g100.css";
  import { TextInput } from "carbon-components-svelte";

  let name = "";
</script>

<TextInput
  labelText="Name"
  placeholder="Enter name"
  bind:value={name}
/>
