<script lang="ts">
  import "carbon-components-svelte/css/g100.css";
  import {
    DataTable,
    TableContainer,
    Toolbar,
    ToolbarContent,
    ToolbarSearch,
  } from "carbon-components-svelte";

  const headers = [
    { key: "name", value: "Name" },
    { key: "role", value: "Role" },
    { key: "status", value: "Status" },
  ];

  const rows = [
    { id: "1", name: "Alice Chen", role: "Admin", status: "Active" },
    { id: "2", name: "Bob Patel", role: "Editor", status: "Active" },
    { id: "3", name: "Carol Diaz", role: "Viewer", status: "Inactive" },
  ];
</script>

<TableContainer
  title="Users"
  description="Manage team members"
>
  <Toolbar>
    <ToolbarContent>
      <ToolbarSearch />
    </ToolbarContent>
  </Toolbar>
  <DataTable
    {headers}
    {rows}
  />
</TableContainer>
