<script lang="ts">
  import "carbon-components-svelte/css/g100.css";
  import {
    Button,
    ComposedModal,
    ModalBody,
    ModalFooter,
    ModalHeader,
  } from "carbon-components-svelte";

  let modalOpen = true;
</script>

<Button on:click={() => (modalOpen = true)}>Open composed modal</Button>

<ComposedModal bind:open={modalOpen}>
  <ModalHeader
    label="Production"
    title="Confirm deployment"
  />
  <ModalBody>
    <p>Deploy the current build to production?</p>
  </ModalBody>
  <ModalFooter
    primaryButtonText="Deploy"
    secondaryButtonText="Cancel"
    on:click:button--secondary={() => (modalOpen = false)}
  />
</ComposedModal>
