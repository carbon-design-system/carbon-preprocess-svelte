<script>
  // The single hover card for every code view. Carbon "layer" surface: ui-01
  // with a ui-03 border and the overflow-menu shadow; signatures in Plex
  // Mono with the same syntax colors as the code.
  import { tick } from "svelte";
  import { highlight } from "carbon-preprocess-svelte/code";
  import { eventType, oneLine as flat, resolveGenerics } from "./analyze.js";
  import { hover, loadApi } from "../settings.js";

  const DOCS = "https://svelte.carbondesignsystem.com/components/";
  const SVELTE_DOCS = "https://svelte.dev/docs/svelte/";
  const icons = import.meta.glob("@icons/*.svelte");

  let card;
  let api = {};
  let top = 0;
  let left = 0;
  let below = true;
  loadApi().then((loaded) => (api = loaded));

  /** Highlighted HTML for a signature. */
  const sig = (code, lang = "ts") => highlight(code, lang) ?? code;
  /** A type with the component's generics resolved: `Item` -> `ComboBoxItem`. */
  const resolved = (type, component) => flat(resolveGenerics(type, api[component])).replace(/<any>/g, "");
  const oneLine = flat;
  /** String-literal union members, for enum chips: `"a" | "b"`. */
  const literals = (type) => {
    const parts = oneLine(type).split("|").map((p) => p.trim());
    return parts.length > 1 && parts.every((p) => /^"[^"]*"$/.test(p)) ? parts.map((p) => p.slice(1, -1)) : null;
  };
  const docsUrl = (name) => (api[name]?.page ? `${DOCS}${api[name].page}` : undefined);
  const iconLoader = (name) => icons[Object.keys(icons).find((k) => k.endsWith(`/${name}.svelte`))];

  $: info = $hover?.info;
  $: if ($hover && card) tick().then(() => card && position($hover.rect));
  const unquote = (value) => /^"(.*)"$/.exec(value ?? "")?.[1];

  function position(rect) {
    const height = card.offsetHeight;
    const width = card.offsetWidth;
    // Prefer above the token, so the card doesn't cover the lines a reader
    // is about to move to; below when there's no room.
    below = rect.top - 8 - height < 0;
    top = below ? rect.bottom + 6 : rect.top - height - 6;
    left = Math.max(8, Math.min(rect.left - 12, innerWidth - width - 8));
  }

  function keep() {
    hover.update((h) => (h ? { ...h, pinned: true } : h));
  }

  function release() {
    hover.update((h) => (h ? { ...h, pinned: false } : h));
    setTimeout(() => hover.update((h) => (h && !h.pinned ? null : h)), 150);
  }

  function cssValue(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  $: symbolType = (symbol) => {
    const handles = symbol.kind === "function" && symbol.usedBy?.find((u) => u.kind === "event");
    if (handles && symbol.params?.length) {
      return `(${symbol.params[0].text}: ${eventType(handles.event, api[handles.component])}) => void`;
    }
    const usage = symbol.usedBy?.find((u) => u.propInfo);
    const fromProp = usage && resolveGenerics(usage.propInfo.type, api[usage.component])?.replace(/<any>/g, "");
    return symbol.type ?? fromProp ?? "unknown";
  };
</script>

{#if info}
  <div
    bind:this={card}
    class="card"
    class:above={!below}
    style:top="{top}px"
    style:left="{left}px"
    role="tooltip"
    aria-live={$hover.viaKeyboard ? "polite" : undefined}
    on:pointerenter={keep}
    on:pointerleave={release}
  >
    {#if info.kind === "component"}
      <div class="head">
        <code class="sig">{@html sig(`<${info.name} />`, "svelte")}</code>
        <span class="tag">component</span>
      </div>
      {#if info.component.description}<p class="text">{info.component.description}</p>{/if}
      <p class="meta">
        {info.component.props.length} props · {info.component.events.length} events{#if info.component.slots?.length} · {info.component.slots.length} slots{/if}
        {#if info.component.rest} · rest props on <code>&lt;{info.component.rest}&gt;</code>{/if}
      </p>
      {@const bindable = info.component.props.filter((p) => p.bindable)}
      {#if bindable.length}
        <p class="chips" aria-label="Bindable props">
          {#each bindable.slice(0, 8) as p}<code class="chip">bind:{p.name}</code>{/each}
        </p>
      {/if}
      <p class="foot">
        <span>carbon-components-svelte</span>
        {#if docsUrl(info.name)}<a href={docsUrl(info.name)} target="_blank" rel="noreferrer">Docs ↗</a>{/if}
      </p>
    {:else if info.kind === "prop"}
      {@const values = literals(info.prop.type)}
      <div class="head">
        <code class="sig">{@html sig(`${info.prop.name}${info.prop.required ? "" : "?"}: ${resolved(info.prop.type, info.component)}`)}</code>
        <span class="tag">{info.directive === "bind" ? "binding" : "prop"}</span>
      </div>
      {#if values}
        <p class="chips" aria-label="Allowed values">
          {#each values as value}
            <code class="chip" class:current={value === (info.literal ?? unquote(info.prop.default))}>{value}</code>
          {/each}
        </p>
      {/if}
      {#if info.prop.description}<p class="text">{info.prop.description}</p>{/if}
      <p class="meta">
        {#if info.prop.default !== undefined && info.prop.default !== "undefined"}Default <code>{info.prop.default}</code>{/if}
        {#if info.prop.bindable}<span class="badge">bindable{info.prop.bindable === "readonly" ? " (read-only)" : ""}</span>{/if}
        {#if info.prop.required}<span class="badge warn">required</span>{/if}
      </p>
      <p class="foot"><span>{info.component}</span>{#if docsUrl(info.component)}<a href={docsUrl(info.component)} target="_blank" rel="noreferrer">Docs ↗</a>{/if}</p>
    {:else if info.kind === "event"}
      <div class="head">
        <code class="sig">{@html sig(`on:${info.name}: ${eventType(info.event, api[info.component])}`)}</code>
        <span class="tag">event</span>
      </div>
      <p class="text">
        {#if !info.event}
          Not in {info.component}'s API. Svelte 4 components only receive events they forward or dispatch.
        {:else if info.event.kind === "dispatched"}
          Dispatched by {info.component}. Read the payload from <code>event.detail</code>.
        {:else}
          Forwarded from the inner <code>&lt;{info.event.element}&gt;</code>{#if info.event.detail}, with <code>{oneLine(info.event.detail)}</code>{/if}.
        {/if}
      </p>
    {:else if info.kind === "symbol"}
      {@const symbol = info.symbol}
      {#if symbol.kind === "import"}
        {@const component = /carbon-components-svelte/.test(symbol.source ?? "") ? api[symbol.imported] : undefined}
        <div class="head">
          <code class="sig">{@html sig(symbol.imported === "default" || /\/lib\//.test(symbol.source ?? "") ? `import ${info.name} from ${symbol.source}` : `import { ${symbol.imported === info.name ? info.name : `${symbol.imported} as ${info.name}`} } from ${symbol.source}`, "js")}</code>
          <span class="tag">import</span>
        </div>
        {#if component?.description}<p class="text">{component.description}</p>{/if}
        {#if /carbon-icons-svelte/.test(symbol.source ?? "") && iconLoader(symbol.imported)}
          {#await iconLoader(symbol.imported)() then icon}
            <p class="icons" aria-label="Icon sizes">
              {#each [16, 20, 24, 32] as size}<span><svelte:component this={icon.default} {size} /><small>{size}</small></span>{/each}
            </p>
          {/await}
        {/if}
      {:else}
        <div class="head">
          <code class="sig">{@html sig(`${symbol.kind} ${info.name}: ${symbolType(symbol)}`)}</code>
          <span class="tag">{symbol.kind}</span>
        </div>
        {#if symbol.initializer}<pre class="init">{@html sig(`= ${symbol.initializer.length > 160 ? `${symbol.initializer.slice(0, 160)}…` : symbol.initializer}`, "js")}</pre>{/if}
      {/if}
      {#each symbol.usedBy ?? [] as usage}
        <p class="meta">
          {symbol.kind === "param" ? "The event of" : usage.kind === "bind" ? "Bound two-way to" : usage.kind === "event" ? "Handles" : "Passed to"}
          <code>{usage.component}{usage.kind === "event" ? ` on:${usage.prop}` : `.${usage.prop}`}</code>
          {#if usage.propInfo}<span class="type">{resolved(usage.propInfo.type, usage.component)}</span>{/if}
        </p>
      {/each}
      <p class="foot"><span>Declared on line {symbol.line} · {symbol.refs.length} {symbol.refs.length === 1 ? "use" : "uses"}</span></p>
    {:else if info.kind === "icon"}
      <div class="head"><code class="sig">{@html sig(`<${info.name} />`, "svelte")}</code><span class="tag">icon</span></div>
      {#if iconLoader(info.name)}
        {#await iconLoader(info.name)() then icon}
          <p class="icons">{#each [16, 20, 24, 32] as size}<span><svelte:component this={icon.default} {size} /><small>{size}</small></span>{/each}</p>
        {/await}
      {/if}
      <p class="foot"><span>{info.symbol.source}</span></p>
    {:else if info.kind === "unknownProp"}
      <div class="head"><code class="sig">{info.name}</code><span class="tag warn">not a prop</span></div>
      <p class="text">
        Not in {info.component}'s API{#if info.rest}, so it's passed to the inner <code>&lt;{info.rest}&gt;</code> as an attribute{/if}.
        {#if info.suggestion}Did you mean <code>{info.suggestion}</code>?{/if}
      </p>
    {:else if info.kind === "directive" || info.kind === "svelte"}
      <div class="head"><code class="sig">{info.title ?? `${info.prefix}:${info.name}`}</code><span class="tag">svelte</span></div>
      <p class="text">{info.text}</p>
      <p class="foot"><a href={SVELTE_DOCS} target="_blank" rel="noreferrer">Svelte docs ↗</a></p>
    {:else if info.kind === "diagnostic"}
      <div class="head">
        <span class="tag {info.problem.severity === 'error' ? 'error' : 'warn'}">{info.problem.severity === "error" ? "Type error" : "Warning"}{#if info.problem.code}&nbsp;TS{info.problem.code}{/if}</span>
      </div>
      <p class="text diagnostic" title={info.problem.message}>{info.message}</p>
      {#if info.suggestion}<p class="text">Did you mean <code>{info.suggestion}</code>?</p>{/if}
      <p class="foot"><span>svelte-check · {info.view} view</span></p>
    {:else if info.kind === "cssVar" || info.kind === "color"}
      {@const value = info.kind === "color" ? info.value : cssValue(info.name)}
      <div class="head">
        <span class="swatch" style:background={value}></span>
        <code class="sig">{info.name ?? info.value}</code>
        <span class="tag">{info.name?.startsWith("--cds-") ? "Carbon token" : "color"}</span>
      </div>
      {#if info.name}<p class="meta">Current theme: <code>{value || "unset"}</code></p>{/if}
    {/if}
  </div>
{/if}

<style>
  .tag.error {
    background-color: color-mix(in srgb, var(--cds-support-01) 16%, transparent);
    color: var(--cds-text-01);
  }

  .diagnostic {
    white-space: pre-wrap;
    font-family: "IBM Plex Mono", monospace;
    font-size: 0.75rem;
  }

  .card {
    position: fixed;
    z-index: 9000;
    max-width: 30rem;
    min-width: 16rem;
    padding: var(--cds-spacing-04) var(--cds-spacing-05);
    border: 1px solid var(--cds-ui-03);
    background: var(--cds-ui-01);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    color: var(--cds-text-01);
    font: 0.875rem/1.29 "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif;
    letter-spacing: 0.16px;
    animation: enter 110ms cubic-bezier(0, 0, 0.38, 0.9);
  }

  @keyframes enter {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
  }

  .card.above {
    animation-name: enter-above;
  }

  @keyframes enter-above {
    from {
      opacity: 0;
      transform: translateY(2px);
    }
  }

  .head {
    display: flex;
    align-items: flex-start;
    gap: var(--cds-spacing-03);
  }

  .sig {
    flex: 1;
    font: 0.8125rem/1.45 "IBM Plex Mono", monospace;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .tag {
    flex: none;
    padding: 0 var(--cds-spacing-03);
    border-radius: 1rem;
    background: var(--cds-ui-03);
    color: var(--cds-text-02);
    font-size: 0.75rem;
    line-height: 1.25rem;
  }

  .tag.warn,
  .badge.warn {
    background: var(--cds-notification-background-warning, var(--cds-ui-03));
    color: var(--cds-text-01);
  }

  .text,
  .meta,
  .chips,
  .foot,
  .icons,
  .init {
    margin-top: var(--cds-spacing-03);
  }

  .text {
    color: var(--cds-text-01);
  }

  .meta {
    color: var(--cds-text-02);
    font-size: 0.75rem;
  }

  .meta code,
  .text code {
    font: 0.75rem "IBM Plex Mono", monospace;
  }

  .type {
    margin-inline-start: var(--cds-spacing-02);
    font: 0.75rem "IBM Plex Mono", monospace;
  }

  .badge {
    margin-inline-start: var(--cds-spacing-03);
    padding: 0 var(--cds-spacing-02);
    background: var(--cds-ui-03);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--cds-spacing-02);
  }

  .chip {
    padding: 0 var(--cds-spacing-02);
    border: 1px solid var(--cds-ui-03);
    font: 0.75rem/1.25rem "IBM Plex Mono", monospace;
  }

  .chip.current {
    border-color: var(--cds-link-01);
    color: var(--cds-link-01);
  }

  .init {
    max-height: 6rem;
    overflow: auto;
    font: 0.75rem/1.4 "IBM Plex Mono", monospace;
    white-space: pre-wrap;
  }

  .icons {
    display: flex;
    align-items: flex-end;
    gap: var(--cds-spacing-05);
  }

  .icons span {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: var(--cds-spacing-02);
    color: var(--cds-text-01);
  }

  .icons small {
    color: var(--cds-text-02);
    font-size: 0.6875rem;
  }

  .swatch {
    flex: none;
    width: 1rem;
    height: 1rem;
    margin-top: 0.1rem;
    border: 1px solid var(--cds-ui-04);
  }

  .foot {
    display: flex;
    justify-content: space-between;
    gap: var(--cds-spacing-05);
    padding-top: var(--cds-spacing-03);
    border-top: 1px solid var(--cds-ui-03);
    color: var(--cds-text-02);
    font-size: 0.75rem;
  }

  .foot a {
    color: var(--cds-link-01);
    text-decoration: none;
  }

  .foot a:hover {
    text-decoration: underline;
  }
</style>
