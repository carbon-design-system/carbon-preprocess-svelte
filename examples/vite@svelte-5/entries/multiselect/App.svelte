<script lang="ts">
  import "carbon-components-svelte/css/g100.css";
  import { MultiSelect } from "carbon-components-svelte";

  const items = [
    { id: "option-1", text: "Option 1" },
    { id: "option-2", text: "Option 2" },
    { id: "option-3", text: "Option 3" },
  ];

  let selectedIds: string[] = ["option-1"];
</script>

<MultiSelect
  titleText="Regions"
  {items}
  bind:selectedIds
/>
