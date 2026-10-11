<script>
  import "carbon-components-svelte/css/all.css";
  import "./variants.css";
  import "./syntax.css";
  import "./code-lines.css";
  import { clearHighlights, highlightAll } from "./highlight-dom.js";
  import Matrix from "./Matrix.svelte";
  import Hovercard from "./intel/Hovercard.svelte";
  import { codeLanguage, packageManager, perf, syntaxMode, terminalTheme } from "./settings.js";
  import { themeScopeCss } from "./theme-scopes.js";
  import ccsPages from "virtual:ccs-pages";
  import "./perf.css";

  // The kitchen sink twice: `.svx` = one Prose per Markdown run, `.md` = one
  // Prose for the page. With `CCS_DIR`, the checkout's docs pages in `CCS_PAGES`.
  const pageOf = (key) => key.split("/").pop().replace(/\.(svx|md)$/, "");
  const modules = {
    ...import.meta.glob("./pages/*.{svx,md}"),
    ...ccsPages,
  };
  const pages = [
    "Matrix",
    ...[...new Set(Object.keys(modules).map(pageOf))].sort((a, b) =>
      a === "KitchenSink" ? -1 : b === "KitchenSink" ? 1 : a.localeCompare(b),
    ),
  ];
  const AXIS_LABELS = {
    variant: "variant",
    theme: "theme",
    kbd: "keys",
    linkTone: "links",
    tableWidth: "tables",
    dividers: "dividers",
  };

  const SELECTS = {
    page: pages.map((p) => [p, p]),
    scope: [
      ["runs", "Prose per Markdown run"],
      ["page", "One Prose for the page"],
    ],
    variant: [
      ["auto", "Variant: default"],
      ["condensed", "Variant: condensed"],
      ["compact", "Variant: compact"],
      ["spacious", "Variant: spacious"],
      ["expressive", "Variant: expressive"],
    ],
    measure: [
      ["auto", "Width: variant's"],
      ["60ch", "Width: 60ch"],
      ["68ch", "Width: 68ch"],
      ["80ch", "Width: 80ch"],
      ["96ch", "Width: 96ch"],
      ["none", "Width: none"],
    ],
    scrollMargin: [
      ["0", "Scroll margin: 0"],
      ["toolbar", "Scroll margin: toolbar"],
      ["6rem", "Scroll margin: 6rem"],
    ],
    // Prose's own props, passed through `proseProps`.
    linkTone: [
      ["default", "Links: default"],
      ["muted", "Links: muted"],
    ],
    tableWidth: [
      ["fit", "Tables: fit"],
      ["full", "Tables: full"],
    ],
    kbd: [
      ["keycap", "Keys: keycap"],
      ["muted", "Keys: muted"],
    ],
    dividers: [
      ["0", "Dividers: off"],
      ["1", "Dividers: on"],
    ],
    codeVariant: [
      ["prose", "Code: Prose variant"],
      ["compact", "Code: compact"],
    ],
    terminal: [
      ["page", "Terminal: page theme"],
      ["g100", "Terminal: g100"],
      ["g90", "Terminal: g90"],
      ["white", "Terminal: white"],
    ],
    syntax: [
      ["build", "Syntax: build-time spans"],
      ["runtime", "Syntax: runtime (CSS Highlight API)"],
      ["off", "Syntax: off"],
    ],
    theme: [
      ["system", "Theme: system"],
      ["white", "Theme: white"],
      ["g10", "Theme: g10"],
      ["g80", "Theme: g80"],
      ["g90", "Theme: g90"],
      ["g100", "Theme: g100"],
    ],
  };
  const TOGGLES = {};
  const DEFAULTS = {
    page: "KitchenSink",
    scope: "runs",
    variant: "auto",
    measure: "auto",
    scrollMargin: "toolbar",
    linkTone: "default",
    tableWidth: "fit",
    kbd: "keycap",
    theme: "system",
    dividers: "0",
    syntax: "build",
    codeVariant: "prose",
    terminal: "page",
    columns: "variant",
    group: "none",
  };

  const params = new URLSearchParams(location.search);
  const state = Object.fromEntries(
    Object.entries(DEFAULTS).map(([k, v]) => [k, params.get(k) ?? v]),
  );
  const chrome = params.get("chrome") !== "0";
  let toolbarHeight = 0;

  $: {
    const next = new URLSearchParams(
      Object.entries(state).filter(([k, v]) => v !== DEFAULTS[k]),
    );
    if (!chrome) next.set("chrome", "0");
    if ($codeLanguage === "ts") next.set("code", "ts");
    if ($packageManager !== "npm") next.set("pm", $packageManager);
    history.replaceState(null, "", `?${next}${location.hash}`);
  }

  // Theme: a Carbon theme, or white/g100 following the OS setting.
  const dark = matchMedia("(prefers-color-scheme: dark)");
  let prefersDark = dark.matches;
  dark.addEventListener("change", (e) => (prefersDark = e.matches));
  $: document.documentElement.setAttribute(
    "theme",
    state.theme === "system" ? (prefersDark ? "g100" : "white") : state.theme,
  );

  $: document.body.className = state.page === "Matrix" ? "matrix" : state.syntax === "build" ? "syntax-build" : "";

  // Code views read these.
  $: syntaxMode.set(state.syntax);
  // Themed regions (`theme="g100"` on a block): see theme-scopes.js.
  if (!document.getElementById("theme-scopes")) {
    const style = Object.assign(document.createElement("style"), { id: "theme-scopes", textContent: themeScopeCss });
    document.head.append(style);
  }
  // Code type and spacing apart from Prose's variant (CCS: a `codeVariant` prop).
  $: if (state.codeVariant === "prose") delete document.body.dataset.codeVariant;
  else document.body.dataset.codeVariant = state.codeVariant;
  $: terminalTheme.set(state.terminal === "page" ? undefined : state.terminal);
  // The JS/TS choice lives in a store the code views share; the URL mirrors it.
  codeLanguage.set(params.get("code") === "ts" ? "ts" : "js");
  // Loading techniques, for A/B: `?lazy=0`, `?cv=0`, `?aot=0`.
  perf.set({ lazy: params.get("lazy") !== "0", cv: params.get("cv") !== "0", aot: params.get("aot") !== "0" });
  if ($perf.cv) document.body.dataset.cv = "";
  // Likewise the package manager for npm commands.
  packageManager.set(["pnpm", "yarn", "bun"].includes(params.get("pm")) ? params.get("pm") : "npm");

  // Runtime highlighting: re-register ranges whenever the page's DOM changes.
  let pending = 0;
  let highlighted = 0;
  const observer = new MutationObserver(() => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      highlighted = state.syntax === "runtime" ? highlightAll() : 0;
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  $: if (state.syntax === "runtime") {
    requestAnimationFrame(() => (highlighted = highlightAll()));
  } else {
    clearHighlights();
  }

  // Prose's own custom property; apps set it to their sticky header's height.
  $: document.documentElement.style.setProperty(
    "--ccs-prose-scroll-margin",
    state.scrollMargin === "toolbar" ? `calc(${toolbarHeight}px + 1rem)` : state.scrollMargin,
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
  $: document.documentElement.style.setProperty(
    "--demo-measure",
    state.measure === "auto" ? "" : state.measure,
  );

  $: key = Object.keys(modules).find(
    (k) => pageOf(k) === state.page && k.endsWith(state.scope === "page" ? ".md" : ".svx"),
  );
  $: loading =
    state.page === "Matrix"
      ? Promise.resolve(null)
      : key
        ? modules[key]()
        : Promise.reject(new Error(`No page ${state.page}`));
</script>

{#if chrome}
  <div class="toolbar" role="toolbar" aria-label="Preview options" bind:clientHeight={toolbarHeight}>
    {#if state.page === "Matrix"}
      <select aria-label="Matrix columns" bind:value={state.columns}>
        {#each Object.entries(AXIS_LABELS) as [value, text]}
          <option {value}>Columns: {text}</option>
        {/each}
      </select>
      <select aria-label="Matrix groups" bind:value={state.group}>
        <option value="none">Group by: none</option>
        {#each Object.entries(AXIS_LABELS).filter(([v]) => v !== state.columns) as [value, text]}
          <option {value}>Group by: {text}</option>
        {/each}
      </select>
    {/if}
    {#each Object.entries(SELECTS) as [name, options]}
      <select aria-label={name} bind:value={state[name]}>
        {#each options as [value, text]}
          <option {value}>{text}</option>
        {/each}
      </select>
    {/each}
    {#each Object.entries(TOGGLES) as [name, text]}
      <label class="toggle">
        <input
          type="checkbox"
          checked={state[name] === "1"}
          on:change={(e) => (state[name] = e.currentTarget.checked ? "1" : "0")}
        />
        {text}
      </label>
    {/each}
  </div>
{/if}

<Hovercard />

{#if state.page === "Matrix"}
  <Matrix
    selects={SELECTS}
    {state}
    columns={state.columns}
    group={state.group === state.columns ? "none" : state.group}
  />
{:else}
{#await loading then mod}
  {#key key}
    <svelte:component this={mod.default} {proseProps} />
  {/key}
{:catch error}
  <p>{error.message}</p>
{/await}
{/if}

<style>
  .toolbar {
    position: sticky;
    z-index: 10;
    top: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--cds-spacing-03);
    padding: var(--cds-spacing-03) var(--cds-spacing-05);
    border-bottom: 1px solid var(--cds-ui-03);
    background: var(--cds-ui-background);
    color: var(--cds-text-01);
    font-size: 0.875rem;
  }

  select {
    height: 2rem;
    padding: 0 var(--cds-spacing-03);
    border: 0;
    border-bottom: 1px solid var(--cds-ui-04);
    background: var(--cds-field-01);
    color: var(--cds-text-01);
    font: inherit;
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--cds-spacing-02);
  }
</style>
