<script lang="ts">
  import "carbon-components-svelte/css/g100.css";
  import {
    DataTable,
    Link,
    OverflowMenu,
    OverflowMenuItem,
  } from "carbon-components-svelte";

  const headers = [
    { key: "name", value: "Name" },
    { key: "link", value: "Details" },
    { key: "action", value: "", empty: true },
  ];

  const rows = [
    { id: "1", name: "Production API", link: "View docs" },
    { id: "2", name: "Staging API", link: "View docs" },
  ];
</script>

<DataTable
  {headers}
  {rows}
>
  <svelte:fragment
    slot="cell"
    let:cell
    let:row
  >
    {#if cell.key === "link"}
      <Link href="#">{cell.value}</Link>
    {:else if cell.key === "action"}
      <OverflowMenu flipped>
        <OverflowMenuItem text="Edit" />
        <OverflowMenuItem
          text="Delete"
          danger
        />
      </OverflowMenu>
    {:else}
      {cell.value}
    {/if}
  </svelte:fragment>
</DataTable>
