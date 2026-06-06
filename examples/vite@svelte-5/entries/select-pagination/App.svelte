<script lang="ts">
  import "carbon-components-svelte/css/g100.css";
  import { Pagination, Select, SelectItem } from "carbon-components-svelte";
</script>

<Pagination
  totalItems={120}
  pageSizes={[10, 20, 50]}
/>

<Select
  inline
  labelText="Rows per page"
>
  <SelectItem
    value={10}
    text="10"
  />
  <SelectItem
    value={20}
    text="20"
  />
  <SelectItem
    value={50}
    text="50"
  />
</Select>
