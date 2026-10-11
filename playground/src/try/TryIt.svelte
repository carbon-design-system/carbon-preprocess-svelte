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
    Checkbox,
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
  import Checkmark from "carbon-icons-svelte/lib/Checkmark.svelte";
  import CheckmarkFilled from "carbon-icons-svelte/lib/CheckmarkFilled.svelte";
  import LinkIcon from "carbon-icons-svelte/lib/Link.svelte";
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
  // The compile options, by `options` key, labeled as written in a config.
  const OPTION_FIELDS = [
    { key: "anchors", label: "anchors" },
    { key: "alerts", label: 'alerts: "InlineNotification"' },
    { key: "codeSnippet", label: "codeSnippet" },
    { key: "expressions", label: "expressions" },
  ];

  let copied = false;
  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

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
  // Reset has something to do only once the draft differs from its sample.
  $: changed = source !== SAMPLES.find((s) => s.id === sample)?.source;
</script>

{#if !shared}<LocalStorage key="playground:try" bind:value={source} />{/if}

<Grid noGutter>
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
        <legend class="bx--label">Compile options</legend>
        <div class="checks">
          {#each OPTION_FIELDS as { key, label } (key)}
            <Checkbox bind:checked={options[key]}>
              <svelte:fragment slot="labelChildren"><code>{label}</code></svelte:fragment>
            </Checkbox>
          {/each}
        </div>
        <p class="bx--form__helper-text">Alerts, codeSnippet, and expressions change the Svelte tab; the preview is plain HTML.</p>
      </fieldset>
    </Column>
  </Row>
  <Row>
    <!-- Two panes: the Markdown with its actions, the output with its tabs. -->
    <Column lg={8} md={8}>
      <div class="pane-head">
        <label class="bx--label" for="try-editor">Markdown</label>
        <div class="actions">
          <Select size="sm" inline labelText="Start from" selected={sample} on:update={(e) => start(e.detail)}>
            {#each SAMPLES as s (s.id)}<SelectItem value={s.id} text={s.label} />{/each}
          </Select>
          <Button kind="ghost" size="small" icon={Reset} iconDescription="Reset to the sample" disabled={!changed} on:click={() => start(sample)} />
          <Button kind="ghost" size="small" icon={copied ? Checkmark : LinkIcon} iconDescription={copied ? "Link copied" : "Copy a link to this draft"} on:click={copyLink} />
        </div>
      </div>
      <TextArea
        id="try-editor"
        class="editor"
        labelText="Markdown"
        hideLabel
        rows={28}
        spellcheck="false"
        helperText={result ? `${lines} lines · compiled in ${result.ms < 1 ? result.ms.toFixed(2) : result.ms.toFixed(1)} ms` : ""}
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
  .options {
    margin-bottom: var(--cds-spacing-06);
  }

  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--cds-spacing-07);
  }

  /* Each as wide as its label, not a share of the row; and without the
     3px Carbon adds above the first and below the last of a vertical group,
     which in a row drops the first box below the others. */
  .checks :global(.bx--form-item) {
    flex: none;
    margin: 0;
  }

  .checks code {
    font: 0.8125rem/1.29 "IBM Plex Mono", monospace;
  }

  .options .bx--form__helper-text {
    margin-top: var(--cds-spacing-02);
  }

  /* As tall as the container tabs beside it, so both panes start level. */
  .pane-head {
    display: flex;
    min-height: 3rem;
    align-items: center;
    justify-content: space-between;
    gap: var(--cds-spacing-05);
  }

  .pane-head .bx--label {
    margin: 0;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--cds-spacing-02);
  }

  .actions :global(.bx--select--inline) {
    margin-right: var(--cds-spacing-03);
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
  }
</style>
