<script>
  /**
   * Try markdown() in the browser: the compiler has no Node dependencies, so
   * the page runs it as you type. The preview is the HTML in Prose; the
   * Svelte tab is the component markdown() would write; the last tab is the
   * headings and frontmatter it exports. The draft stays in CCS's
   * `LocalStorage`.
   *
   * Both come from `carbon-preprocess-svelte/code`: `compileMarkdown` for
   * the component, `markdownToHtml` for the preview. The preview renders the
   * user's own HTML, in their own browser; nothing is shared or sent.
   */
  import {
    Button,
    Column,
    Grid,
    InlineNotification,
    LocalStorage,
    Row,
    Select,
    SelectItem,
    Tab,
    TabContent,
    Tabs,
    TextArea,
  } from "carbon-components-svelte";
  import Reset from "carbon-icons-svelte/lib/Reset.svelte";
  import { carbonCodeIcon, compileMarkdown, highlight, markdownToHtml } from "carbon-preprocess-svelte/code";
  import CodeView from "../CodeView.svelte";
  import { SAMPLES } from "./samples.js";
  import ProsePreview from "./ProsePreview.sample";

  /** Runtime Prose props from the settings, as pages get them. */
  export let proseProps = {};

  let sample = SAMPLES[0].id;
  let source = SAMPLES[0].source;
  let selected = 0;
  let result;
  let error;

  // The options this playground's pages use (Carbon icons, the built-in
  // highlighter, anchors on h2 and h3), so the output is what a page gets.
  const OPTIONS = { prose: true, codeIcons: carbonCodeIcon, highlight, anchors: { depths: [2, 3] } };
  const COMPONENT = /^<([A-Z][\w.]*)/;
  const SCRIPT = /^<script\b/m;
  const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  /** A component or `{#if}` in the preview: a placeholder that names it. */
  function placeholder(markup) {
    const name = COMPONENT.exec(markup)?.[1];
    const label = name ? `<code>${escape(`<${name}>`)}</code> renders here` : "A Svelte block renders here";
    return `<p class="try-placeholder">${label} in the compiled page.</p>`;
  }

  let run = 0;
  let timer;
  // Only `source` is a dependency: reading `result` here would recompile
  // every time a compile sets it, forever.
  $: schedule(source);

  /** Compile at once the first time, then once typing pauses. */
  function schedule(text) {
    clearTimeout(timer);
    timer = setTimeout(() => compile(text), result ? 120 : 0);
  }

  async function compile(text) {
    const id = ++run;
    // A mark per compile, for the tests and DevTools' Performance panel.
    performance.mark("try:compile");
    try {
      const start = performance.now();
      const compiled = await compileMarkdown(text, { ...OPTIONS, filename: "Page.md" });
      const ms = performance.now() - start;
      let usesSvelte = false;
      const preview = await markdownToHtml(text, {
        highlight,
        anchors: OPTIONS.anchors,
        svelteBlock(markup) {
          usesSvelte = true;
          return placeholder(markup);
        },
      });
      if (id !== run) return;
      result = {
        ms,
        svelte: compiled.code,
        html: preview.html,
        // A component or block, or a script (which the preview drops).
        usesSvelte: usesSvelte || SCRIPT.test(text),
        exports: JSON.stringify({ metadata: compiled.metadata, headings: compiled.headings }, null, 2),
      };
      error = undefined;
    } catch (e) {
      if (id === run) error = e;
    }
  }

  function start(id) {
    sample = id;
    source = SAMPLES.find((s) => s.id === id).source;
  }

  $: lines = source.split("\n").length;
</script>

<LocalStorage key="playground:try" bind:value={source} />

<Grid noGutter>
  <Row>
    <Column lg={16}>
      <div class="toolbar">
        <Select size="sm" inline labelText="Start from" selected={sample} on:update={(e) => start(e.detail)}>
          {#each SAMPLES as s (s.id)}<SelectItem value={s.id} text={s.label} />{/each}
        </Select>
        <Button kind="ghost" size="small" icon={Reset} on:click={() => start(sample)}>Reset</Button>
        <p class="status bx--type-helper-text-01">
          {#if result}{lines} lines · compiled in {result.ms < 1 ? result.ms.toFixed(2) : result.ms.toFixed(1)} ms{/if}
        </p>
      </div>
    </Column>
  </Row>
  <Row>
    <Column lg={8} md={8}>
      <TextArea
        class="editor"
        labelText="Markdown"
        rows={28}
        spellcheck="false"
        invalid={Boolean(error)}
        invalidText={error?.message}
        bind:value={source}
      />
    </Column>
    <Column lg={8} md={8}>
      <Tabs bind:selected>
        <Tab label="Preview" />
        <Tab label="Svelte" />
        <Tab label="Headings and metadata" />
        <svelte:fragment slot="content">
          <TabContent>
            {#if result?.usesSvelte}
              <InlineNotification
                kind="info"
                lowContrast
                hideCloseButton
                title="Markdown only."
                subtitle="The preview is HTML: components and scripts run in the compiled page (the Svelte tab)."
              />
            {/if}
            <!-- Scrolls: focusable, so a keyboard can scroll it too. -->
            <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
            <div class="preview" role="region" aria-label="Preview" tabindex="0">
              {#if result}<ProsePreview html={result.html} {proseProps} />{/if}
            </div>
          </TabContent>
          <TabContent>
            {#if selected === 1 && result}
              {#key result.svelte}<CodeView code={result.svelte} lang="svelte" maxCollapsedLines={60} />{/key}
            {/if}
          </TabContent>
          <TabContent>
            {#if selected === 2 && result}
              {#key result.exports}<CodeView code={result.exports} lang="json" maxCollapsedLines={60} />{/key}
            {/if}
          </TabContent>
        </svelte:fragment>
      </Tabs>
    </Column>
  </Row>
</Grid>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--cds-spacing-05);
    margin-bottom: var(--cds-spacing-05);
  }

  .status {
    margin-left: auto;
    color: var(--cds-text-02);
    font-variant-numeric: tabular-nums;
  }

  :global(.editor) {
    min-height: 36rem;
    font-family: "IBM Plex Mono", monospace;
    font-size: 0.8125rem;
    line-height: 1.5;
    resize: vertical;
  }

  .preview :global(.try-placeholder) {
    padding: var(--cds-spacing-04) var(--cds-spacing-05);
    border: 1px dashed var(--cds-ui-04);
    color: var(--cds-text-02);
  }

  .preview {
    max-height: 36rem;
    overflow: auto;
    padding: var(--cds-spacing-05) var(--cds-spacing-05) var(--cds-spacing-07);
    border: 1px solid var(--cds-ui-03);
  }
</style>
