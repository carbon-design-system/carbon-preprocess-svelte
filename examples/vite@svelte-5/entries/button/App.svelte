<script lang="ts">
  import "carbon-components-svelte/css/g100.css";
  import { Button } from "carbon-components-svelte";
  import Add from "./AddIcon.svelte";
</script>

<Button>Primary</Button>
<Button kind="secondary">Secondary</Button>
<Button kind="danger">Delete</Button>
<Button
  icon={Add}
  iconDescription="Add"
  tooltipPosition="top"
/>
