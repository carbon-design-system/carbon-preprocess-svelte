<script lang="ts">
  import "carbon-components-svelte/css/white.css";
  import {
    Button,
    Tab,
    TabContent,
    Tabs,
    truncate,
  } from "carbon-components-svelte";
</script>

<Tabs>
  <Tab label="Tab label 1" />
  <Tab label="Tab label 2" />
  <svelte:fragment slot="content">
    <TabContent>
      <p use:truncate>
        Content 1 is long enough to be truncated by the `truncate` action.
      </p>
    </TabContent>
    <TabContent>
      <Button>Content 2</Button>
    </TabContent>
  </svelte:fragment>
</Tabs>
