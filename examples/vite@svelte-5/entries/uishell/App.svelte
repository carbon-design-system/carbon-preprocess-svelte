<script lang="ts">
  import "carbon-components-svelte/css/g100.css";
  import {
    Content,
    Header,
    SideNav,
    SideNavItems,
    SideNavLink,
    SkipToContent,
  } from "carbon-components-svelte";

  let isSideNavOpen = true;
</script>

<SkipToContent />
<Header
  bind:isSideNavOpen
  companyName="Carbon App"
/>
<SideNav bind:isOpen={isSideNavOpen}>
  <SideNavItems>
    <SideNavLink
      href="#"
      text="Dashboard"
    />
    <SideNavLink
      href="#"
      text="Settings"
    />
  </SideNavItems>
</SideNav>
<Content>
  <h1>Dashboard</h1>
</Content>
