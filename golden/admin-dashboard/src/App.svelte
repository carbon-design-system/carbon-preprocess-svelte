<script lang="ts">
  import {
    Content,
    Header,
    HeaderGlobalAction,
    HeaderUtilities,
    SideNav,
    SideNavItems,
    SideNavLink,
    SkipToContent,
    ToastNotification,
  } from "carbon-components-svelte";
  import { NAV, type PageId } from "./lib/constants";
  import { toasts } from "./lib/stores";
  import Overview from "./Overview.svelte";
  import Settings from "./Settings.svelte";
  import Users from "./Users.svelte";

  let isSideNavOpen = $state(false);
  let page: PageId = $state("overview");
</script>

<Header
  companyName="Acme"
  platformName="Admin"
  bind:isSideNavOpen
>
  <svelte:fragment slot="skipToContent">
    <SkipToContent />
  </svelte:fragment>
  <HeaderUtilities>
    <HeaderGlobalAction aria-label="Notifications" />
  </HeaderUtilities>
</Header>

<SideNav bind:isOpen={isSideNavOpen}>
  <SideNavItems>
    {#each NAV as item (item.id)}
      <SideNavLink
        text={item.text}
        href="#{item.id}"
        isSelected={page === item.id}
        onclick={() => (page = item.id)}
      />
    {/each}
  </SideNavItems>
</SideNav>

<Content>
  {#if page === "overview"}
    <Overview />
  {:else if page === "users"}
    <Users />
  {:else}
    <Settings />
  {/if}
</Content>

<div class="toasts">
  {#each $toasts as toast (toast.id)}
    <ToastNotification
      kind={toast.kind}
      title={toast.title}
      lowContrast
      timeout={4000}
    />
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
  }
</style>
