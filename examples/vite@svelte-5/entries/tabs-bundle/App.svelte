<script lang="ts">
  import "carbon-components-svelte/css/g100.css";
  import { Tab, TabContent, Tabs } from "carbon-components-svelte";

  let selected = 0;
</script>

<Tabs bind:selected>
  <Tab label="Overview" />
  <Tab label="Activity" />
  <svelte:fragment slot="content">
    <TabContent>
      <p>Overview panel</p>
    </TabContent>
    <TabContent>
      <p>Activity panel</p>
    </TabContent>
  </svelte:fragment>
</Tabs>
