<script>
  /**
   * Try markdown() in the browser: the compiler has no Node dependencies, so
   * the page runs it as you type. The preview is the HTML in Prose; the
   * Svelte tab is the component markdown() would write; the last tab is the
   * headings and frontmatter it exports. The draft stays in CCS's
   * `LocalStorage`.
   *
   * Both come from `carbon-preprocess-svelte/code`: `compileMarkdown` for
   * the component, `markdownToHtml` for the preview. Options change the
   * compile; Svelte's own compiler (loaded with the Svelte tab) checks the
   * output. A draft can be shared as a link (`#draft=`, gzipped): the
   * preview strips what runs code from its HTML (`sanitize.js`), and a
   * shared draft isn't saved over the reader's own.
   */
  import { onMount } from "svelte";
  import {
    Button,
    Column,
    CopyButton,
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
    Toggle,
  } from "carbon-components-svelte";
  import CheckmarkFilled from "carbon-icons-svelte/lib/CheckmarkFilled.svelte";
  import LogoSvelte from "carbon-icons-svelte/lib/LogoSvelte.svelte";
  import Reset from "carbon-icons-svelte/lib/Reset.svelte";
  import TableOfContents from "carbon-icons-svelte/lib/TableOfContents.svelte";
  import View from "carbon-icons-svelte/lib/View.svelte";
  import { carbonCodeIcon, compileMarkdown, highlight, markdownToHtml } from "carbon-preprocess-svelte/code";
  import CodeView from "../CodeView.svelte";
  import { compressAndEncode, decodeAndDecompress } from "../intel/playground.js";
  import { sanitize } from "./sanitize.js";
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
  // highlighter), and the ones the toggles set.
  const OPTIONS = { prose: true, codeIcons: carbonCodeIcon, highlight };
  let options = { anchors: true, alerts: false, codeSnippet: false, expressions: false };
  $: compileOptions = {
    ...OPTIONS,
    anchors: options.anchors && { depths: [2, 3] },
    alerts: options.alerts ? "InlineNotification" : "blockquote",
    codeSnippet: options.codeSnippet,
    expressions: options.expressions,
  };

  // A shared draft (`#draft=`): shown, not saved over the reader's own.
  // Known before the first render, so LocalStorage never mounts for it (it
  // would load the reader's draft, then save the shared one over it).
  const DRAFT = /^#draft=([\w-]+)$/;
  const encoded = DRAFT.exec(location.hash)?.[1];
  let shared = Boolean(encoded);
  let shareUrl = "";
  onMount(async () => {
    if (!encoded) return;
    try {
      source = await decodeAndDecompress(encoded);
    } catch {
      // Not a draft we can read: back to the reader's own.
      backToMine();
    }
  });
  function backToMine() {
    shared = false;
    history.replaceState(null, "", location.pathname + location.search);
  }
  let shareRun = 0;
  $: {
    // Only the latest: an earlier, slower compression mustn't win.
    const id = ++shareRun;
    compressAndEncode(source).then((encoded) => {
      if (id === shareRun) shareUrl = `${location.origin}${location.pathname}${location.search}#draft=${encoded}`;
    });
  }

  // Svelte's compiler, loaded with the Svelte tab: does the output compile?
  let svelteCompiler;
  let check;
  $: if (selected === 1 && !svelteCompiler) svelteCompiler = import("svelte/compiler");
  $: if (svelteCompiler && result) checkOutput(result.svelte);
  async function checkOutput(code) {
    const { compile } = await svelteCompiler;
    try {
      compile(code, { filename: "Page.svelte", generate: false });
      check = { ok: true };
    } catch (e) {
      check = { ok: false, message: e.message.split("\n")[0], line: e.start?.line };
    }
  }
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
  // Only the source and the options are dependencies: reading `result` here
  // would recompile every time a compile sets it, forever.
  $: schedule(source, compileOptions);

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
      const compiled = await compileMarkdown(text, { ...compileOptions, filename: "Page.md" });
      const ms = performance.now() - start;
      let usesSvelte = false;
      const preview = await markdownToHtml(text, {
        highlight,
        anchors: compileOptions.anchors,
        svelteBlock(markup) {
          usesSvelte = true;
          return placeholder(markup);
        },
      });
      if (id !== run) return;
      result = {
        ms,
        svelte: compiled.code,
        html: sanitize(preview.html),
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
    if (shared) backToMine();
    sample = id;
    source = SAMPLES.find((s) => s.id === id).source;
  }

  $: lines = source.split("\n").length;
</script>

{#if !shared}<LocalStorage key="playground:try" bind:value={source} />{/if}

<Grid noGutter>
  <Row>
    <Column lg={16}>
      <div class="toolbar">
        <Select size="sm" inline labelText="Start from" selected={sample} on:update={(e) => start(e.detail)}>
          {#each SAMPLES as s (s.id)}<SelectItem value={s.id} text={s.label} />{/each}
        </Select>
        <Button kind="ghost" size="small" icon={Reset} on:click={() => start(sample)}>Reset</Button>
        <CopyButton text={shareUrl} iconDescription="Copy a link to this draft" feedback="Link copied" />
        <p class="status bx--type-helper-text-01">
          {#if result}{lines} lines · compiled in {result.ms < 1 ? result.ms.toFixed(2) : result.ms.toFixed(1)} ms{/if}
        </p>
      </div>
    </Column>
  </Row>
  {#if shared}
    <Row>
      <Column lg={16}>
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title="A shared draft."
          subtitle="Edits here aren't saved, and your own draft is unchanged."
        >
          <svelte:fragment slot="actions">
            <Button kind="ghost" size="small" on:click={backToMine}>Back to my draft</Button>
          </svelte:fragment>
        </InlineNotification>
      </Column>
    </Row>
  {/if}
  <Row>
    <Column lg={16}>
      <fieldset class="options">
        <legend class="bx--label">Options</legend>
        <Toggle size="sm" labelText="anchors" labelA="Off" labelB="On" bind:toggled={options.anchors} />
        <Toggle size="sm" labelText={'alerts: "InlineNotification"'} labelA="Off" labelB="On" bind:toggled={options.alerts} />
        <Toggle size="sm" labelText="codeSnippet" labelA="Off" labelB="On" bind:toggled={options.codeSnippet} />
        <Toggle size="sm" labelText="expressions" labelA="Off" labelB="On" bind:toggled={options.expressions} />
        <p class="bx--form__helper-text">Alerts, CodeSnippet, and expressions change the Svelte tab; the preview is plain HTML.</p>
      </fieldset>
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
      <Tabs type="container" bind:selected>
        <Tab label="Preview" icon={View} />
        <Tab label="Svelte" icon={LogoSvelte} />
        <Tab label="Headings and metadata" icon={TableOfContents} />
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
              {#if check && !check.ok}
                <InlineNotification
                  kind="error"
                  lowContrast
                  hideCloseButton
                  title="Svelte can't compile this."
                  subtitle={check.line ? `Line ${check.line}: ${check.message}` : check.message}
                />
              {:else if check?.ok}
                <p class="compiles bx--type-helper-text-01"><CheckmarkFilled /> Svelte compiles this.</p>
              {/if}
              {#key `${result.svelte}:${check?.line}`}
                <CodeView
                  code={result.svelte}
                  lang="svelte"
                  meta={check?.line ? `{${check.line}} showLineNumbers` : ""}
                  maxCollapsedLines={60}
                />
              {/key}
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

  .options {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--cds-spacing-03) var(--cds-spacing-07);
    margin-bottom: var(--cds-spacing-06);
  }

  .options legend {
    width: 100%;
  }

  .options .bx--form__helper-text {
    width: 100%;
    margin: 0;
  }

  .compiles {
    display: flex;
    align-items: center;
    gap: var(--cds-spacing-02);
    margin-bottom: var(--cds-spacing-03);
    color: var(--cds-text-02);
  }

  .compiles :global(svg) {
    fill: var(--cds-support-02);
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
