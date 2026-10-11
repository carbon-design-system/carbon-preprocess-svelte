<script>
  /**
   * Try markdown() in the browser: the compiler has no Node dependencies, so
   * the page runs it as you type. The preview is the HTML in Prose; the
   * Svelte tab is the component markdown() would write; the last tab is the
   * headings and frontmatter it exports. The draft stays in CCS's
   * `LocalStorage`.
   *
   * The compiler isn't a public browser entry (yet): this imports it from
   * the repo's source. The preview renders the user's own HTML, in their own
   * browser; nothing is shared or sent.
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
  import { carbonCodeIcon, highlight } from "carbon-preprocess-svelte/code";
  import { compileMarkdown, renderMarkdown } from "../../../src/markdown/compile";
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
  // A fence's lines come back as `{@html "…"}` (they can hold `{`); the
  // preview is plain HTML.
  const AT_HTML = /\{@html ("(?:[^"\\]|\\.)*")\}/g;
  const toHtml = (markup) => markup.replace(AT_HTML, (_, string) => JSON.parse(string));
  const COMPONENT = /^<([A-Z][\w.]*)/;
  const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  /** The rendered page as HTML: Svelte blocks (components, `{#if}`) become placeholders. */
  function previewHtml(rendered) {
    let html = rendered.html;
    for (const part of rendered.parts) {
      if (!part.svelte) continue;
      const name = COMPONENT.exec(part.html)?.[1];
      const label = name ? `<code>${escape(`<${name}>`)}</code> renders here` : "A Svelte block renders here";
      html = html.replace(part.html, `<p class="try-placeholder">${label} in the compiled page.</p>`);
    }
    return toHtml(html);
  }

  let run = 0;
  let timer;
  $: {
    clearTimeout(timer);
    const text = source;
    timer = setTimeout(() => compile(text), result ? 120 : 0);
  }

  async function compile(text) {
    const id = ++run;
    try {
      const start = performance.now();
      const compiled = await compileMarkdown(text, { ...OPTIONS, filename: "Page.md" });
      const ms = performance.now() - start;
      // The preview: the same blocks, without Svelte-only output (icons).
      const rendered = await renderMarkdown(text, { ...OPTIONS, codeIcons: false });
      if (id !== run) return;
      result = {
        ms,
        svelte: compiled.code,
        html: previewHtml(rendered),
        usesSvelte: rendered.hoisted.length > 0 || rendered.parts.some((part) => part.svelte),
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
