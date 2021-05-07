<script>
  import "carbon-components-svelte/css/g10.css";
  import { Button } from "carbon-components-svelte";
</script>

<!-- toc -->

<h1>Welcome to SvelteKit</h1>
<p>
  Visit <a href="https://kit.svelte.dev">kit.svelte.dev</a> to read the documentation
</p>

<h2>Carbon button</h2>

<Button>Hello world</Button>

<h2>Inline pictograms</h2>

<icon name="Add16" />
<pictogram name="Airplane" class="pictogram" />

<style>
  p {
    background: "ui-03";
  }

  .pictogram {
    fill: "interactive-01";
  }
</style>
