<script lang="ts">
  import "carbon-components-svelte/css/g100.css";
  import { Button, Modal } from "carbon-components-svelte";

  let modalOpen = true;
</script>

<Button on:click={() => (modalOpen = true)}>Open modal</Button>

<Modal
  bind:open={modalOpen}
  modalHeading="Confirm deployment"
  primaryButtonText="Deploy"
  secondaryButtonText="Cancel"
  on:click:button--secondary={() => (modalOpen = false)}
>
  <p>Deploy the current build to production?</p>
</Modal>
