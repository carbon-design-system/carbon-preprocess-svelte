<script>
  /**
   * The playground's shell: Carbon's UI Shell around the page. The header
   * holds the theme switch and two panels (about, settings); the side nav
   * lists pages; changed settings show as tags above the page. Options come
   * from `shell/options.js` and live in the URL. `?chrome=0` hides the shell,
   * for screenshots and tests.
   */
  import "carbon-components-svelte/css/all.css";
  import "./variants.css";
  import "./syntax.css";
  import "./code-lines.css";
  import "./perf.css";
  import {
    Content,
    Header,
    HeaderAction,
    HeaderGlobalAction,
    HeaderSearch,
    HeaderUtilities,
    ClickableTile,
    Column,
    Grid,
    InlineNotification,
    LocalStorage,
    SideNav,
    SideNavItems,
    SideNavLink,
    SideNavMenu,
    Row,
    SkipToContent,
    Theme,
  } from "carbon-components-svelte";
  import Asleep from "carbon-icons-svelte/lib/Asleep.svelte";
  import Carbon from "carbon-icons-svelte/lib/Carbon.svelte";
  import Code from "carbon-icons-svelte/lib/Code.svelte";
  import Dashboard from "carbon-icons-svelte/lib/Dashboard.svelte";
  import Document from "carbon-icons-svelte/lib/Document.svelte";
  import GridIcon from "carbon-icons-svelte/lib/Grid.svelte";
  import Information from "carbon-icons-svelte/lib/Information.svelte";
  import Light from "carbon-icons-svelte/lib/Light.svelte";
  import Meter from "carbon-icons-svelte/lib/Meter.svelte";
  import Settings from "carbon-icons-svelte/lib/Settings.svelte";
  import ccsPages from "virtual:ccs-pages";
  import searchIndex from "virtual:search-index";
  import { setContext, tick } from "svelte";
  import { writable } from "svelte/store";
  import { clearHighlights, highlightAll } from "./highlight-dom.js";
  import Hovercard from "./intel/Hovercard.svelte";
  import Matrix from "./Matrix.svelte";
  import { codeLanguage, packageManager, perf, syntaxMode, tabGroups, terminalTheme } from "./settings.js";
  import AboutPanel from "./shell/AboutPanel.svelte";
  import ChangedTags from "./shell/ChangedTags.svelte";
  import { DEFAULTS, fromQuery, OPTIONS } from "./shell/options.js";
  import SettingsPanel from "./shell/SettingsPanel.svelte";
  import { themeScopeCss } from "./theme-scopes.js";

  const build = __PLAYGROUND__;

  // Pages: the playground's own (the kitchen sink twice: `.svx` = one Prose
  // per Markdown run, `.md` = one for the page), and with `CCS_DIR`, the
  // checkout's docs pages in `CCS_PAGES`.
  const pageOf = (key) => key.split("/").pop().replace(/\.(svx|md)$/, "");
  const modules = { ...import.meta.glob("./pages/*.{svx,md}"), ...ccsPages };
  const NAV = [
    {
      label: "Playground",
      pages: [
        { name: "KitchenSink", text: "Kitchen sink", icon: Document },
        { name: "Try", text: "Try markdown()", icon: Code },
        { name: "Matrix", text: "Matrix", icon: GridIcon },
        { name: "Stress", text: "Stress", icon: Dashboard },
      ],
    },
    {
      label: "Benches",
      pages: [
        { name: "MountBench", text: "Mount cost", icon: Meter },
        { name: "InteractBench", text: "Interaction latency", icon: Meter },
      ],
    },
  ];
  const CCS_NAV = Object.keys(ccsPages).map(pageOf).sort();
  const PAGES = new Set(["Matrix", ...Object.keys(modules).map(pageOf)]);

  // State: every option, plus the page and the Matrix's axes.
  const params = new URLSearchParams(location.search);
  const chrome = params.get("chrome") !== "0";
  const page = params.get("page");
  let state = {
    ...fromQuery(params),
    page: page && PAGES.has(page) ? page : "KitchenSink",
    columns: params.get("columns") ?? "variant",
    group: params.get("group") ?? "none",
  };
  const MATRIX_DEFAULTS = { page: "KitchenSink", columns: "variant", group: "none" };

  /** The query for `state` with some keys changed: only what differs from the defaults. */
  function queryFor(next) {
    const query = new URLSearchParams(
      Object.entries(next).filter(([k, v]) => v !== (DEFAULTS[k] ?? MATRIX_DEFAULTS[k])),
    );
    if (next.page !== "Matrix") {
      query.delete("columns");
      query.delete("group");
    }
    if (!chrome) query.set("chrome", "0");
    return `?${query}`;
  }

  $: history.replaceState(null, "", `${queryFor(state)}${location.hash}`);

  function setOption({ key, value }) {
    const option = OPTIONS.find((o) => o.key === key);
    // Loading techniques apply when the page loads.
    if (option?.reload) {
      location.search = queryFor({ ...state, [key]: value });
      return;
    }
    state[key] = value;
  }

  function resetOptions() {
    const reload = OPTIONS.some((o) => o.reload && state[o.key] !== o.default);
    if (reload) {
      location.search = queryFor({ ...state, ...DEFAULTS });
      return;
    }
    // An assignment, so Svelte sees it.
    state = { ...state, ...DEFAULTS };
  }

  function goTo(event, name) {
    event.preventDefault();
    state.page = name;
    if (window.innerWidth < 1056) isSideNavOpen = false;
    window.scrollTo(0, 0);
  }

  // Theme: a Carbon theme, or white/g100 following the OS setting.
  const dark = matchMedia("(prefers-color-scheme: dark)");
  let prefersDark = dark.matches;
  dark.addEventListener("change", (e) => (prefersDark = e.matches));
  $: resolvedTheme = state.theme === "system" ? (prefersDark ? "g100" : "white") : state.theme;
  $: isDark = ["g80", "g90", "g100"].includes(resolvedTheme);

  $: document.body.className = state.page === "Matrix" ? "matrix" : state.syntax === "build" ? "syntax-build" : "";

  // Code views read these stores; their own switches write them back.
  $: syntaxMode.set(state.syntax);
  $: terminalTheme.set(state.terminal === "page" ? undefined : state.terminal);
  // Seeded from the URL before subscribing, so the stores' defaults don't win.
  codeLanguage.set(state.code);
  packageManager.set(state.pm);
  $: codeLanguage.set(state.code);
  $: packageManager.set(state.pm);
  codeLanguage.subscribe((value) => value !== state.code && (state.code = value));
  packageManager.subscribe((value) => value !== state.pm && (state.pm = value));
  perf.set({ lazy: state.lazy === "1", cv: state.cv === "1", aot: state.aot === "1" });
  if (state.cv === "1") document.body.dataset.cv = "";

  // Themed regions (`theme="g100"` on a block or a panel): see theme-scopes.js.
  if (!document.getElementById("theme-scopes")) {
    const style = Object.assign(document.createElement("style"), { id: "theme-scopes", textContent: themeScopeCss });
    document.head.append(style);
  }
  // Code type and spacing apart from Prose's variant (CCS: a `codeVariant` prop).
  $: if (state.codeVariant === "prose") delete document.body.dataset.codeVariant;
  else document.body.dataset.codeVariant = state.codeVariant;

  // Runtime highlighting: re-register ranges whenever the page's DOM changes.
  let pending = 0;
  const observer = new MutationObserver(() => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      if (state.syntax === "runtime") highlightAll();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  $: if (state.syntax === "runtime") requestAnimationFrame(() => highlightAll());
  else clearHighlights();

  // Prose's own custom property: room for the 48px header above a linked heading.
  $: document.documentElement.style.setProperty(
    "--ccs-prose-scroll-margin",
    state.scrollMargin === "header" ? (chrome ? "calc(3rem + 1rem)" : "1rem") : state.scrollMargin,
  );

  // Runtime Prose props, passed to the page as `proseProps`.
  $: proseProps = {
    ...(state.variant !== "auto" && { variant: state.variant }),
    ...(state.measure !== "auto" && { maxWidth: state.measure }),
    linkTone: state.linkTone,
    tableWidth: state.tableWidth,
    kbd: state.kbd,
    dividers: state.dividers === "1",
  };
  $: document.documentElement.style.setProperty("--demo-measure", state.measure === "auto" ? "" : state.measure);

  // The page loads only when the page or scope changes: through these
  // primitives, other settings (which change `state`) don't remount it.
  $: pageName = state.page;
  $: scope = state.scope;
  $: key = Object.keys(modules).find((k) => pageOf(k) === pageName && k.endsWith(scope === "page" ? ".md" : ".svx"));
  $: loading =
    pageName === "Matrix"
      ? Promise.resolve(null)
      : key
        ? modules[key]()
        : Promise.reject(new Error(`No page ${pageName}`));

  // The page a Layout belongs to, for its source view (virtual:page-sources).
  const currentPage = writable(state.page);
  setContext("playground:page", currentPage);
  $: currentPage.set(pageName);

  // Search: pages and their h2 and h3 headings (virtual:search-index).
  const ENTRIES = searchIndex.flatMap(({ page, title, headings }) => [
    { page, title, text: title, description: "Page" },
    ...headings.map((h) => ({ page, title, hash: h.id, text: h.text, description: title })),
  ]);
  let query = "";
  $: terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  $: results = terms.length
    ? ENTRIES.filter((e) => terms.every((t) => `${e.text} ${e.description}`.toLowerCase().includes(t)))
        .slice(0, 12)
        .map((e) => ({ ...e, id: `${e.page}#${e.hash ?? ""}`, href: `${queryFor({ ...state, page: e.page })}${e.hash ? `#${e.hash}` : ""}` }))
    : [];

  /** Open a page, then scroll to the heading once it has rendered. */
  async function open(page, hash) {
    if (state.page !== page) {
      state.page = page;
      window.scrollTo(0, 0);
      await tick();
      await loading;
      await tick();
    }
    if (hash) {
      document.getElementById(hash)?.scrollIntoView({ block: "start" });
      history.replaceState(null, "", `${location.search}#${hash}`);
    }
  }

  // Previous and next: the side nav's order.
  $: order = [...NAV.flatMap((section) => section.pages.map((p) => ({ name: p.name, text: p.text }))), ...CCS_NAV.map((name) => ({ name, text: name }))];
  $: at = order.findIndex((p) => p.name === state.page);
  $: previous = at > 0 ? order[at - 1] : undefined;
  $: next = at >= 0 && at < order.length - 1 ? order[at + 1] : undefined;

  let isSideNavOpen = false;
  let settingsOpen = false;
  let aboutOpen = false;
</script>

{#if chrome}
  <Header companyName="carbon-preprocess-svelte" platformName="Playground" href="?" bind:isSideNavOpen>
    <svelte:fragment slot="skipToContent">
      <SkipToContent />
    </svelte:fragment>
    <HeaderUtilities>
      <HeaderSearch
        bind:value={query}
        {results}
        placeholder="Search pages and headings"
        on:select={(e) => open(e.detail.selectedResult.page, e.detail.selectedResult.hash)}
      />
      <HeaderGlobalAction
        iconDescription={isDark ? "Light theme" : "Dark theme"}
        tooltipAlignment="end"
        icon={isDark ? Light : Asleep}
        on:click={() => setOption({ key: "theme", value: isDark ? "white" : "g100" })}
      />
      <HeaderAction icon={Information} iconDescription="About this build" tooltipAlignment="end" bind:isOpen={aboutOpen}>
        <AboutPanel {build} pages={PAGES.size} ccsPages={CCS_NAV.length} />
      </HeaderAction>
      <HeaderAction icon={Settings} iconDescription="Settings" tooltipAlignment="end" bind:isOpen={settingsOpen}>
        <SettingsPanel {state} hasProse={build.prose} on:change={(e) => setOption(e.detail)} on:reset={resetOptions} />
      </HeaderAction>
    </HeaderUtilities>
  </Header>

  <SideNav bind:isOpen={isSideNavOpen} ariaLabel="Pages">
    <SideNavItems>
      <!-- Sections start with a label; no SideNavDivider: its <li role="separator">
           fails axe's list rule (a CCS bug), so the label carries the rule line. -->
      {#each NAV as section, index (section.label)}
        <li class="nav-label bx--type-label-01" class:ruled={index > 0}>{section.label}</li>
        {#each section.pages as item (item.name)}
          <SideNavLink
            href={queryFor({ ...state, page: item.name })}
            text={item.text}
            icon={item.icon}
            isSelected={state.page === item.name}
            on:click={(event) => goTo(event, item.name)}
          />
        {/each}
      {/each}
      {#if CCS_NAV.length}
        <li class="nav-label bx--type-label-01 ruled">Carbon Components Svelte</li>
        <SideNavMenu text="CCS docs" icon={Carbon} expanded>
          {#each CCS_NAV as name (name)}
            <SideNavLink
              href={queryFor({ ...state, page: name })}
              text={name}
              isSelected={state.page === name}
              on:click={(event) => goTo(event, name)}
            />
          {/each}
        </SideNavMenu>
      {/if}
    </SideNavItems>
  </SideNav>
{/if}

<!-- The page's theme (and its color-scheme, for native controls and scrollbars). -->
<Theme theme={resolvedTheme} />
<!-- Synced code groups' choices, across pages, reloads, and tabs. -->
<LocalStorage key="playground:code-groups" bind:value={$tabGroups} />
<Hovercard />

<Content class={chrome ? "with-shell" : "no-shell"}>
  {#if chrome}
    <ChangedTags {state} on:change={(e) => setOption(e.detail)} on:reset={resetOptions} />
    {#if !build.prose}
      <InlineNotification
        kind="warning"
        lowContrast
        hideCloseButton
        title="No Prose."
        subtitle="{build.ccs} doesn't have it, so pages render as plain HTML and Prose's settings are off. Set CCS_DIR to a checkout with Prose in playground/.env.local, then restart."
      />
    {/if}
  {/if}

  {#if state.page === "Matrix"}
    <Matrix
      selects={Object.fromEntries(OPTIONS.map((o) => [o.key, o.values]))}
      axes={OPTIONS.filter((o) => o.axis)}
      {state}
      bind:columns={state.columns}
      bind:group={state.group}
    />
  {:else}
    {#await loading then mod}
      {#key key}
        <svelte:component this={mod.default} {proseProps} />
      {/key}
    {:catch error}
      <InlineNotification kind="error" lowContrast hideCloseButton title="Can't load the page." subtitle={error.message} />
    {/await}
  {/if}

  {#if chrome && (previous || next)}
    <!-- In the page's grid, under its content column. -->
    <Grid>
      <Row>
        <Column lg={12} md={6}>
          <nav class="page-nav" aria-label="Previous and next pages">
            {#if previous}
              <ClickableTile href={queryFor({ ...state, page: previous.name })} on:click={(event) => goTo(event, previous.name)}>
                <span class="bx--type-label-01">Previous</span>
                <span class="bx--type-productive-heading-02">{previous.text}</span>
              </ClickableTile>
            {/if}
            {#if next}
              <ClickableTile class="next" href={queryFor({ ...state, page: next.name })} on:click={(event) => goTo(event, next.name)}>
                <span class="bx--type-label-01">Next</span>
                <span class="bx--type-productive-heading-02">{next.text}</span>
              </ClickableTile>
            {/if}
          </nav>
        </Column>
      </Row>
    </Grid>
  {/if}
</Content>

<style>
  /* Previous and next, as Carbon's docs end a page: two tiles, next on the right. */
  .page-nav {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    margin: var(--cds-spacing-10) 0 var(--cds-spacing-07);
  }

  /* Results name their page as written ("Kitchen sink"), not lowercased. */
  :global(.bx--header-search-menu-description) {
    text-transform: none;
  }

  /* A linked heading clears the 48px header. Zero specificity past [id],
     so Prose's own scroll margin (a setting) wins where there's Prose. */
  :global(:where(.bx--content.with-shell) :where(h1, h2, h3, h4)[id]) {
    scroll-margin-top: calc(3rem + var(--cds-spacing-05));
  }

  .page-nav :global(.bx--tile) {
    display: flex;
    flex-direction: column;
    gap: var(--cds-spacing-02);
  }

  .page-nav :global(.next) {
    grid-column: 2;
    align-items: flex-end;
    text-align: end;
  }

  /* Section labels in the side nav, in Carbon's sentence case. */
  .nav-label {
    margin: 0 var(--cds-spacing-05);
    padding: var(--cds-spacing-05) 0 var(--cds-spacing-03);
    color: var(--cds-text-02);
  }

  .nav-label.ruled {
    margin-top: var(--cds-spacing-03);
    border-top: 1px solid var(--cds-ui-03);
  }

  /* The settings panel needs room for its fields: wider than Carbon's
     default 16rem panel, and scrollable. */
  :global(.bx--header-panel:has(.settings)),
  :global(.bx--header-panel:has(.about)) {
    width: 20rem;
    overflow-y: auto;
    border-left: 1px solid var(--cds-ui-03);
    background-color: var(--cds-ui-background);
  }

  /* Without the shell: the page from the top, with no room for a nav. */
  :global(.bx--content.no-shell) {
    margin: 0;
    padding: 0;
  }

  /* The changed-settings bar runs edge to edge above the page, over the
     content's top padding. */
  :global(.bx--content.with-shell > .changed) {
    margin: calc(-1 * var(--cds-spacing-07)) calc(-1 * var(--cds-spacing-07)) var(--cds-spacing-07);
  }

  :global(.bx--content.with-shell > .bx--inline-notification) {
    max-width: none;
    margin: 0 0 var(--cds-spacing-07);
  }

  /* On small screens, the product name alone: the prefix would wrap. */
  @media (max-width: 41.98rem) {
    :global(.bx--header__name--prefix) {
      display: none;
    }
  }

  :global(.bx--header__name) {
    white-space: nowrap;
  }
</style>
