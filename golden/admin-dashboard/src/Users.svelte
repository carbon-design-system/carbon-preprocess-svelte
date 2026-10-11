<script lang="ts">
  import {
    Button,
    DataTable,
    DataTableSkeleton,
    Modal,
    OverflowMenu,
    OverflowMenuItem,
    Pagination,
    Tag,
    Toolbar,
    ToolbarContent,
    ToolbarSearch,
  } from "carbon-components-svelte";
  import { onMount } from "svelte";
  import { deleteUser, fetchUsers, type User } from "./lib/api";
  import {
    DEFAULT_PAGE_SIZE,
    PAGE_SIZES,
    STATUS_TAG,
    TABLE_SIZE,
  } from "./lib/constants";
  import { t } from "./lib/i18n";
  import { notify } from "./lib/stores";

  const headers = [
    { key: "name", value: "Name" },
    { key: "email", value: "Email" },
    { key: "role", value: "Role" },
    { key: "status", value: "Status" },
    { key: "actions", empty: true },
  ];

  let users: User[] = $state([]);
  let loading = $state(true);
  let page = $state(1);
  let pageSize = $state(DEFAULT_PAGE_SIZE);
  let filteredRowIds: string[] = $state([]);
  let pendingDelete: User | undefined = $state();

  onMount(async () => {
    users = await fetchUsers();
    loading = false;
  });

  async function confirmDelete() {
    if (!pendingDelete) return;
    await deleteUser(pendingDelete.id);
    users = users.filter((user) => user.id !== pendingDelete?.id);
    notify("success", `${pendingDelete.name} was removed`);
    pendingDelete = undefined;
  }
</script>

{#if loading}
  <DataTableSkeleton
    {headers}
    rows={DEFAULT_PAGE_SIZE}
  />
{:else}
  <DataTable
    title={t("users.title")}
    description={t("users.description")}
    sortable
    size={TABLE_SIZE}
    {headers}
    rows={users}
    {page}
    {pageSize}
  >
    <Toolbar>
      <ToolbarContent>
        <ToolbarSearch
          persistent
          shouldFilterRows
          bind:filteredRowIds
        />
        <Button>{t("users.add")}</Button>
      </ToolbarContent>
    </Toolbar>
    <svelte:fragment
      slot="cell"
      let:row
      let:cell
    >
      {#if cell.key === "status"}
        <Tag type={STATUS_TAG[cell.value as User["status"]]}>{cell.value}</Tag>
      {:else if cell.key === "actions"}
        <OverflowMenu flipped>
          <OverflowMenuItem text="Edit" />
          <OverflowMenuItem
            danger
            text={t("users.delete")}
            on:click={() => (pendingDelete = row as User)}
          />
        </OverflowMenu>
      {:else}
        {cell.value}
      {/if}
    </svelte:fragment>
  </DataTable>
  <Pagination
    bind:page
    bind:pageSize
    pageSizes={PAGE_SIZES}
    totalItems={filteredRowIds.length}
  />
{/if}

<Modal
  danger
  open={pendingDelete !== undefined}
  modalHeading={t("users.delete")}
  primaryButtonText={t("users.delete")}
  secondaryButtonText="Cancel"
  on:click:button--secondary={() => (pendingDelete = undefined)}
  on:close={() => (pendingDelete = undefined)}
  on:submit={confirmDelete}
>
  <p>{t("users.deleteConfirm")}</p>
</Modal>
