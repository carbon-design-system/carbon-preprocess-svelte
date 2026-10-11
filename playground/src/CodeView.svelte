<script>
  // A docs code view: Carbon syntax colors through the CSS Custom Highlight
  // API (one text node per line, no token spans), a JS/TS switch, hover
  // cards ("fake IntelliSense") from the component API, and the fence's
  // line features (marks, line numbers, title, terminal prompts) in the
  // preprocessor's `.line` markup. Keyboard: focus the code, then ←/→ step
  // through the symbols that have a card; Escape closes it.
  //
  // Also: line links (click a line number to copy a link to it, shift-click
  // for a range), a copy button per terminal command, and an npm / pnpm /
  // yarn / bun switch for blocks of npm commands. Several files (a
  // `::: code-group`, or a multi-file example) show as tabs. Past 15 lines a
  // block collapses, as Carbon's CodeSnippet does, behind "Show more"; the
  // hidden lines stay findable with the browser's find in page.
  //
  // Loading: views and token data come from the build (`views`), so the
  // browser only paints; hover analysis and the component API wait for the
  // first pointer or focus. Painting, controls, and lines behind "Show more"
  // wait until the view nears the viewport or the browser is idle.
  import { onDestroy, onMount, tick } from "svelte";
  import Checkmark from "carbon-icons-svelte/lib/Checkmark.svelte";
  import ChevronDown from "carbon-icons-svelte/lib/ChevronDown.svelte";
  import ErrorFilled from "carbon-icons-svelte/lib/ErrorFilled.svelte";
  import Launch from "carbon-icons-svelte/lib/Launch.svelte";
  import { playgroundUrl } from "./intel/playground.js";
  import Copy from "carbon-icons-svelte/lib/Copy.svelte";
  import { Button, CopyButton } from "carbon-components-svelte";
  import FileTabs from "./FileTabs.svelte";
  import LangSwitch from "./LangSwitch.svelte";
  import {
    ansiToHtml,
    decodeTokens,
    encodeTokens,
    hasAnsi,
    prepareFence,
    stripAnsi,
    tokenName,
  } from "carbon-preprocess-svelte/code";
  import { analyze } from "./intel/analyze.js";
  import { clearRanges, setRanges, supported } from "./intel/registry.js";
  import { MANAGERS, packageManagerVariants } from "./intel/package-managers.js";
  import { toJSDoc, toTypeScript } from "./intel/typescript.js";
  import { codeLanguage, hover, loadApi, packageManager, perf, syntaxMode, tabGroups, terminalTheme } from "./settings.js";

  /** The JavaScript source. */
  export let code = "";
  export let lang = "svelte";
  /** The fence's metadata: `title="…" {2-4} ins={5} showLineNumbers`. */
  export let meta = "";
  /** Several files, shown as tabs: `{ name, lang, code, meta? }[]`. Overrides `code`, `lang`, and `meta`. */
  export let files = undefined;
  /** The file or language icon (a component), from the build's `codeIcons`. */
  export let icon = undefined;
  /** Icons for `files`, by index. */
  export let icons = undefined;
  /** The status icon, for a fence with `kind`, `do`, or `dont`. */
  export let statusIcon = undefined;
  /** Build-time views and their token data: `{ source, js?, ts? }`, each `{ code, tokens }`. */
  export let views = undefined;
  /** Offer "Open in Svelte Playground" (complete examples). */
  export let playground = false;
  /** For `files`: tabs in groups of this name select the same label together. */
  export let group = undefined;
  /** Lines shown before "Show more", as in CodeSnippet. */
  export let maxCollapsedLines = 15;

  let active = 0;
  let expanded = false;
  const uid = Math.random().toString(36).slice(2, 8);

  const id = Symbol("codeview");
  const relatedOwner = Symbol("related");
  let codeEl;
  let api;
  let analysis;
  let focusIndex = -1;
  let showTimer;
  let hideTimer;
  let nodes = []; // each line's text node
  let lineOfNode = new Map();
  let preEl;
  let rootEl;
  let blockId = "";
  let target; // { from, to }: linked lines, by displayed number
  let anchorLine; // where a shift-click range starts
  let copied = -1; // the command line whose copy button shows a check
  let copiedTimer;
  let announcement = "";
  const LABELS = { ansi: "Output", svelte: "Svelte", js: "JavaScript", javascript: "JavaScript", ts: "TypeScript", sh: "Shell", bash: "Shell", shell: "Shell", zsh: "Shell" };

  // The library's own derivation: markers, prompts, and diff signs removed.
  function lineFeatures(code, lang, metaText) {
    const fence = prepareFence(code, lang, metaText);
    return { ...fence.meta, source: fence.code, terminal: fence.terminal, plain: fence.plain, lang: fence.lang };
  }

  $: file = files?.[active] ?? { code, lang, meta };
  $: features = lineFeatures(file.code, file.lang, file.meta ?? "");
  // Typed views add lines, which would move the marks: keep marked code as written.
  $: fixedLines = features.marks.size > 0 || features.lineNumbers !== undefined || !!features.terminal;
  $: label = features.terminal
    ? "Terminal"
    : (LABELS[features.lang] ?? (wantsTs && !hasScript ? "TypeScript" : features.lang.toUpperCase() || "Diff")) +
      (features.diff || file.lang.startsWith("diff-") ? " diff" : "");
  $: hasFocus = [...features.marks.values()].some((marks) => marks.has("focus"));
  // Terminal output and `ansi` blocks: ANSI colors, carried from line to line.
  $: ansiBlock = features.lang === "ansi";
  // Dependencies passed in, so Svelte orders this after them.
  $: ansiHtml = ansiBlock || features.terminal ? ansiLines(lines, ansiBlock, isOutput) : [];
  function ansiLines(lines, whole, isOutput) {
    let style = {};
    return lines.map((line, i) => {
      if (!whole && !isOutput(i + 1)) return undefined;
      if (!hasAnsi(line, whole)) return undefined;
      const result = ansiToHtml(line, { literals: whole, style });
      style = result.style;
      return result.html;
    });
  }
  // A theme for the block alone, or the terminal theme for shell sessions and output.
  $: blockTheme = features.theme ?? (features.terminal || ansiBlock ? $terminalTheme : undefined);

  $: hasScript = file.lang === "svelte" && /<script[\s>]/.test(file.code);
  $: canSwitch = !fixedLines && (hasScript || file.lang === "js" || file.lang === "javascript");
  $: wantsTs = canSwitch && $codeLanguage === "ts";
  // Hover analysis starts on the first pointer or focus.
  let intel = false;
  // Without build-time views, typed views need the component API up front.
  $: if ((hasScript && !prepared) || intel) loadApi().then((loaded) => (api = loaded));
  // JS shows JSDoc types; TS shows idiomatic annotations. Both derive from
  // the authored (untyped) example.
  // npm commands, in the reader's package manager. Not for sessions with
  // output, which is npm's own.
  $: isShell = ["sh", "bash", "shell", "zsh"].includes(file.lang);
  $: onlyCommands = !features.terminal || features.terminal.commands.size === features.source.split("\n").length;
  $: managers = isShell && onlyCommands ? packageManagerVariants(features.source) : undefined;
  $: viewKey = hasScript && !fixedLines ? (wantsTs ? "ts" : "js") : "source";
  $: prepared = managers ? undefined : (files ? file.views : views)?.[viewKey];
  $: displayed = managers
    ? managers[$packageManager]
    : prepared
      ? prepared.code
      : hasScript && api && !fixedLines ? (wantsTs ? toTypeScript(file.code, api) : toJSDoc(file.code, api)) : features.source;
  $: lines = displayed.split("\n");
  $: lineStarts = offsetsOf(lines);
  // Hiding a line or two isn't worth a click: collapse only past a few more.
  $: collapsible = features.collapse.length === 0 && maxCollapsedLines > 0 && lines.length >= maxCollapsedLines + 4;
  // Folded sections (`collapse={1-8}`): a "Show N lines" row in place of
  // closed ones. 0-based start -> { end, index }.
  let openFolds = new Set();
  $: folds = new Map(features.collapse.map(([from, to], index) => [from - 1, { end: Math.min(to, lines.length), index }]));
  $: hiddenLines = hiddenOf(folds, openFolds);
  function hiddenOf(folds, open) {
    const hidden = new Set();
    for (const [start, { end, index }] of folds) {
      if (open.has(index)) continue;
      for (let i = start; i < end; i++) hidden.add(i);
    }
    return hidden;
  }
  function toggleFold(index) {
    openFolds = new Set(openFolds.has(index) ? [...openFolds].filter((i) => i !== index) : [...openFolds, index]);
  }
  $: collapsed = collapsible && !expanded;
  $: isOutput = (number) => features.terminal && !features.terminal.commands.has(number);
  // Copy what a reader would run: no deleted lines, prompts, or output.
  $: copyText = lines
    .filter((_, i) => !features.marks.get(i + 1)?.has("del") && !isOutput(i + 1))
    .map((line) => (ansiBlock ? stripAnsi(line, true) : line))
    .join("\n");
  $: firstNumber = features.lineNumbers ?? 1;
  $: isTarget = (i) => target && firstNumber + i >= target.from && firstNumber + i <= target.to;
  /** A command's lines: its prompt line and any `\` continuations. */
  $: commandText = (i) => {
    let end = i;
    while (features.terminal.commands.has(end + 2) && !features.terminal.prompts.has(end + 2)) end++;
    return lines.slice(i, end + 1).join("\n");
  };
  $: displayLang = features.lang === "javascript" ? "js" : wantsTs && !hasScript ? "ts" : features.lang;
  // Paint only near the viewport: a long page's blocks don't all cost time
  // at load. Build-time tokens when they match what's shown; otherwise
  // tokenize here.
  let visible = !$perf.lazy;
  $: paintTokens = visible
    ? $perf.aot && prepared?.tokens
      ? decodeTokens(prepared.tokens)
      : decodeTokens(encodeTokens(displayed, displayLang) ?? [])
    : undefined;
  // Type errors from `typecheck-examples.ts`, for the view shown.
  $: diagnostics = (!managers && prepared?.diagnostics) || [];
  $: typeErrors = diagnostics.filter((d) => d.severity === "error").length;

  // Symbols with hover cards, underlined from the start: from the build, or
  // from analysis once it has run.
  $: cardRanges = visible
    ? prepared?.cards
      ? decodePairs(prepared.cards)
      : analysis
        ? [...analysis.info.keys()].map((index) => analysis.tokens[index])
        : []
    : [];
  function decodePairs(data) {
    const ranges = [];
    let offset = 0;
    for (let i = 0; i + 1 < data.length; i += 2) {
      const start = offset + data[i];
      ranges.push({ start, end: start + data[i + 1] });
      offset = start + data[i + 1];
    }
    return ranges;
  }
  $: if (codeEl && paintTokens) paint(paintTokens, $syntaxMode, collapsed, cardRanges, hiddenLines, diagnostics);
  $: analysis = intel ? analyze(displayed, displayLang, api) : undefined;

  // Lines behind "Show more" render in idle chunks, so a long block doesn't
  // build them all at load; showing, linking, or finding renders the rest.
  $: tailTotal = collapsible ? lines.length - maxCollapsedLines : 0;
  let tailRendered = 0;
  let tailPending = false;
  $: if (!$perf.lazy || !collapsed) tailRendered = tailTotal;
  $: if (tailRendered < tailTotal && !tailPending) {
    tailPending = true;
    idle(() => {
      tailPending = false;
      tailRendered = Math.min(tailTotal, tailRendered + 200);
    });
  }
  const idle = (callback) =>
    typeof requestIdleCallback === "function" ? requestIdleCallback(callback, { timeout: 2000 }) : setTimeout(callback, 1);
  // A height to reserve while `content-visibility` skips the block.
  $: shownLines = collapsible && collapsed ? maxCollapsedLines : lines.length;
  $: lineHeight = features.variant === "compact" || document.body.dataset.codeVariant === "compact" ? 16 : 20.02;
  $: reserve = Math.round(40 + 32 + (collapsible ? 16 : 0) + shownLines * lineHeight);

  /** Each line's text node, for mapping offsets to the DOM. */
  function refreshNodes() {
    // An empty line renders no text node: give it one, so offsets map.
    // By line: folded lines aren't rendered, so the list has gaps.
    nodes = [];
    for (const el of codeEl.querySelectorAll(".text")) {
      nodes[Number(el.dataset.line)] = el.firstChild ?? el.appendChild(document.createTextNode(""));
    }
    lineOfNode = new Map(nodes.map((node, i) => [node, i]).filter(([node]) => node));
  }

  /** The token covering `offset` (tokens are in order). */
  function tokenAt(offset) {
    const tokens = analysis.tokens;
    let low = 0;
    let high = tokens.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (tokens[mid].end <= offset) low = mid + 1;
      else if (tokens[mid].start > offset) high = mid - 1;
      else return tokens[mid];
    }
    return undefined;
  }

  /** Where each line starts in the joined text. */
  function offsetsOf(lines) {
    const starts = new Array(lines.length);
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      starts[i] = offset;
      offset += lines[i].length + 1;
    }
    return starts;
  }

  /** 0-based line of a character offset. */
  function lineOf(offset) {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  /** A DOM range for a span of `displayed`, across line nodes if needed. */
  function rangeAt(start, end) {
    const range = document.createRange();
    const a = lineOf(start);
    const b = lineOf(end);
    if (!nodes[b]?.isConnected) refreshNodes();
    // A folded line has no node.
    if (!nodes[a] || !nodes[b]) return undefined;
    range.setStart(nodes[a], Math.min(start - lineStarts[a], lines[a].length));
    range.setEnd(nodes[b], Math.min(end - lineStarts[b], lines[b].length));
    return range;
  }

  async function paint(tokens, mode, collapsedNow, cards = [], _hidden, problems = []) {
    await tick();
    if (!codeEl) return;
    refreshNodes();
    if (!supported) return;
    if (mode === "off") return clearRanges(id);
    const groups = new Map();
    // Lines behind "Show more" get colors when shown.
    const end = collapsedNow ? lineStarts[maxCollapsedLines] : Infinity;
    for (const token of tokens) {
      if (token.start >= end) break;
      if (!token.type || isOutput(lineOf(token.start) + 1) || features.plain.has(lineOf(token.start) + 1)) continue;
      // A token crossing the fold is painted up to it.
      const range = rangeAt(token.start, Math.min(token.end, end - 1));
      if (!range) continue;
      const name = `syntax-${tokenName(token.type)}`;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(range);
    }
    const available = cards
      .filter((card) => card.start < end)
      .map((card) => rangeAt(card.start, Math.min(card.end, end - 1)))
      .filter(Boolean);
    if (available.length) groups.set("intel-available", available);
    for (const severity of ["error", "warning"]) {
      const ranges = problems
        .filter((d) => d.severity === severity && d.start < end)
        .map((d) => rangeAt(d.start, Math.min(d.end, end - 1)))
        .filter(Boolean);
      if (ranges.length) groups.set(`type-${severity}`, ranges);
    }
    setRanges(id, groups);
    // Squiggles win over the dotted card underline.
    for (const name of ["type-error", "type-warning"]) {
      const highlight = CSS.highlights.get(name);
      if (highlight) highlight.priority = 1;
    }
    // Text nodes are mapped now: answer a pointer that arrived first.
    if (analysis) retryHover();
  }

  /** Character offset under the pointer, or -1. */
  function offsetAt(x, y) {
    const caret = document.caretPositionFromPoint?.(x, y);
    const node = caret ? caret.offsetNode : document.caretRangeFromPoint?.(x, y)?.startContainer;
    const offset = caret ? caret.offset : document.caretRangeFromPoint?.(x, y)?.startOffset;
    const line = lineOfNode.get(node);
    return line === undefined ? -1 : lineStarts[line] + offset;
  }

  const rangeOf = (token) => rangeAt(token.start, token.end);

  /** TypeScript quotes whole types; keep each to its head: `'Properties<ButtonProps<…>>'`. */
  function shorten(message) {
    const first = message.split("\n")[0];
    return first.replace(/'([^']{48,})'/g, (_, type) => {
      const head = /^[\w.$]+/.exec(type)?.[0];
      return head ? `'${head}<…>'` : `'${type.slice(0, 40)}…'`;
    });
  }

  /** The example as shown (JS or TS view), with its local modules, in a new playground. */
  async function openPlayground() {
    const shown = files
      ? files.map((f, i) => ({ name: f.name, code: i === active ? displayed : (f.views?.[viewKey]?.code ?? f.code) }))
      : [{ name: "Example.svelte", code: displayed }];
    // The example first: the selected file if it's a component, else the first.
    const main = files && !shown[active].name.endsWith(".svelte") ? 0 : files ? active : 0;
    const ordered = [shown[main], ...shown.filter((_, i) => i !== main)];
    const theme = document.documentElement.getAttribute("theme") ?? "white";
    window.open(await playgroundUrl(ordered, { theme }), "_blank", "noopener");
  }

  /** From the header: expand to the first type error, scroll to it, and show its message. */
  async function revealProblem() {
    const problem = diagnostics.find((d) => d.severity === "error");
    if (!problem) return;
    if (collapsed && lineOf(problem.start) >= maxCollapsedLines) expanded = true;
    openFolds = new Set(features.collapse.map((_, index) => index));
    await tick();
    await paint(paintTokens, $syntaxMode, collapsed, cardRanges, hiddenLines, diagnostics);
    const range = rangeAt(problem.start, problem.end);
    range?.startContainer.parentElement?.scrollIntoView({ block: "center" });
    await new Promise(requestAnimationFrame);
    showProblem(problem);
  }

  function showProblem(problem) {
    if ($hover?.owner === id && $hover.info?.problem === problem) return clearTimeout(hideTimer);
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    const range = rangeAt(problem.start, problem.end);
    if (!range) return;
    // The analyzer may know better: "Did you mean `iconDescription`?"
    const token = analysis ? tokenAt(problem.start) : undefined;
    const known = token ? analysis.info.get(token.index) : undefined;
    const suggestion = known?.kind === "unknownProp" ? known.suggestion : undefined;
    showTimer = setTimeout(() => {
      hover.set({
        info: { kind: "diagnostic", problem, message: shorten(problem.message), suggestion, view: viewKey === "ts" ? "TypeScript" : "JavaScript (JSDoc)" },
        rect: range.getBoundingClientRect(),
        owner: id,
        viaKeyboard: false,
        lang: displayLang,
      });
    }, $hover ? 60 : 200);
  }

  function show(index, viaKeyboard = false) {
    const token = analysis.tokens[index];
    const info = analysis.info.get(index);
    if (!token || !info) return;
    clearTimeout(hideTimer);
    const related = (analysis.related.get(index) ?? [index]).map((i) => rangeOf(analysis.tokens[i])).filter(Boolean);
    setRanges(relatedOwner, new Map([["intel-related", related], ["intel-hover", [rangeOf(token)]]]));
    hover.set({ info, rect: rangeOf(token).getBoundingClientRect(), owner: id, line: token.line, viaKeyboard, lang: displayLang });
  }

  function hide(delay = 180) {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      clearRanges(relatedOwner);
      hover.update((h) => (h?.owner === id && !h.pinned ? null : h));
    }, delay);
  }

  // The first pointer over a block starts analysis: answer it once ready.
  let lastPointer;
  $: if (analysis) retryHover();
  function retryHover() {
    if (lastPointer) onPointerMove(lastPointer);
  }

  function onPointerMove(event) {
    lastPointer = { clientX: event.clientX, clientY: event.clientY };
    if (!api) loadApi().then((loaded) => (api = loaded));
    const offset = offsetAt(event.clientX, event.clientY);
    // A type error under the pointer: its message.
    const problem = offset < 0 ? undefined : diagnostics.find((d) => offset >= d.start && offset < d.end);
    if (problem) return showProblem(problem);
    const token = offset < 0 || !analysis ? undefined : tokenAt(offset);
    // The caret API snaps to the nearest character; require the pointer to be on it.
    const inside = token && (() => {
      const r = rangeOf(token).getBoundingClientRect();
      return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
    })();
    if (!inside || !analysis.info.has(token.index)) return hide();
    if ($hover?.owner === id && $hover.info === analysis.info.get(token.index)) return clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(token.index), $hover ? 60 : 300);
  }

  async function onKeydown(event) {
    if (!analysis) return;
    if (event.key === "Escape") {
      focusIndex = -1;
      return hide(0);
    }
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const indices = [...analysis.info.keys()].sort((a, b) => a - b);
    if (indices.length === 0) return;
    event.preventDefault();
    const position = indices.indexOf(focusIndex);
    const next = event.key === "ArrowRight" ? indices[(position + 1) % indices.length] : indices[(position - 1 + indices.length) % indices.length];
    focusIndex = next;
    if (collapsed && lineOf(analysis.tokens[next].start) >= maxCollapsedLines) {
      expanded = true;
      await tick();
    }
    rangeOf(analysis.tokens[next]).startContainer.parentElement?.scrollIntoView?.({ block: "nearest" });
    show(next, true);
  }

  /** Line links: `#<block>-L14` or `#<block>-L14-L16`. In a file group, `<block>` is a file name and selects its tab. */
  function readHash() {
    const match = /^#(.+?)-L(\d+)(?:-L(\d+))?$/.exec(decodeURIComponent(location.hash));
    const ids = files ? files.map((f) => slug(f.name)) : [blockId];
    const index = match ? ids.indexOf(match[1]) : -1;
    if (index < 0) return (target = undefined);
    if (files && index !== active) selectFile(index);
    const [from, to] = [Number(match[2]), Number(match[3] ?? match[2])].sort((a, b) => a - b);
    target = { from, to };
    return target;
  }

  /** Expand if the linked lines are past the fold, then scroll to them. */
  async function reveal() {
    await tick();
    if (collapsed && target && target.to - firstNumber >= maxCollapsedLines) {
      expanded = true;
      await tick();
    }
    // `.linked` opts the block out of `content-visibility`. Reading a box
    // forces the layout that applies it; without it, scrolling to a line in
    // a block skipped at load goes nowhere.
    const line = codeEl.querySelector("[data-target]");
    line?.getBoundingClientRect();
    line?.scrollIntoView({ block: "center" });
  }

  // Synced groups: the label selected anywhere selects it here too.
  $: if (files && group && $tabGroups?.[group] !== undefined) {
    const index = files.findIndex((f) => f.name === $tabGroups?.[group]);
    if (index >= 0 && index !== active) showFile(index);
  }

  function selectFile(index) {
    showFile(index);
    if (files && group) tabGroups.update((groups) => ({ ...groups, [group]: files[index].name }));
  }

  function showFile(index) {
    active = index;
    openFolds = new Set();
    expanded = false;
    tailRendered = 0;
    hide(0);
  }

  async function toggle() {
    expanded = !expanded;
    await tick();
    // Collapsing from far down: bring the block back into view.
    if (!expanded && preEl.getBoundingClientRect().top < 0) preEl.scrollIntoView({ block: "nearest" });
  }

  /** `hidden="until-found"`: hidden lines that find in page can still reveal. */
  function untilFound(node, hidden) {
    const apply = (value) => (value ? node.setAttribute("hidden", "until-found") : node.removeAttribute("hidden"));
    apply(hidden);
    return { update: apply };
  }

  async function linkLine(event, i) {
    event.preventDefault();
    const number = firstNumber + i;
    const [from, to] = event.shiftKey && target && anchorLine !== undefined ? [anchorLine, number].sort((a, b) => a - b) : [number, number];
    if (!event.shiftKey || !target) anchorLine = number;
    history.replaceState(history.state, "", `${location.search}#${blockId}-L${from}${to > from ? `-L${to}` : ""}`);
    // Other code views drop their target.
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await navigator.clipboard?.writeText(location.href).catch(() => {});
    announcement = `Link to ${to > from ? `lines ${from} to ${to}` : `line ${from}`} copied`;
  }

  async function copyCommand(i) {
    await navigator.clipboard?.writeText(commandText(i)).catch(() => {});
    copied = i;
    announcement = "Command copied";
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = -1), 1500);
  }

  let position = 0; // this view's place on the page
  const idOf = (file, features) =>
    file.name ? slug(file.name) : features.title ? slug(features.title) : `code-${position}`;
  $: if (position) blockId = idOf(file, features);

  const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  onMount(() => {
    // A file name makes a stable id; otherwise the block's place on the page.
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      visible = true;
      observer.disconnect();
    }, { rootMargin: "600px 0px" });
    // The root, not the `pre`: under `content-visibility`, skipped contents have no box to intersect.
    observer.observe(rootEl);
    position = [...document.querySelectorAll("pre[data-codeview]")].indexOf(preEl) + 1;
    blockId = idOf(file, features);
    const onHash = () => readHash() && reveal();
    window.addEventListener("hashchange", onHash);
    if (readHash()) reveal();
    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", onHash);
    };
  });

  onDestroy(() => {
    clearTimeout(copiedTimer);
    clearRanges(id);
    clearRanges(relatedOwner);
    hover.update((h) => (h?.owner === id ? null : h));
  });
</script>

<!-- `bx--code-view`: a Carbon-prefixed class, so an enclosing Prose leaves the code view alone. -->
<div
  bind:this={rootEl}
  class="codeview bx--code-view"
  class:linked={target}
  data-kind={features.kind}
  data-variant={features.variant}
  theme={blockTheme} style:contain-intrinsic-size="auto {reserve}px">
  <div class="bar" class:tabbed={files}>
    {#if files}
      <FileTabs
        id="tab-{uid}"
        panel="code-{uid}"
        {icons}
        names={files.map((f) => f.name)}
        selected={active}
        on:change={(event) => selectFile(event.detail)}
      />
    {:else}
      <!-- `iconOnly`: the name stays for screen readers, and as a tooltip. -->
      <span class="lang" class:title={features.title} title={features.iconOnly && icon ? (features.title ?? label) : undefined}
        >{#if icon}<svelte:component this={icon} class="icon" />{/if}<span class:bx--assistive-text={features.iconOnly && icon}
          >{features.title ?? label}</span
        ></span
      >
    {/if}
    {#if typeErrors}
      <button type="button" class="status type-errors" on:click={revealProblem}
        ><ErrorFilled class="icon" />{typeErrors} type {typeErrors === 1 ? "error" : "errors"}</button
      >
    {/if}
    {#if features.kind}
      <span class="status"
        >{#if statusIcon}<svelte:component this={statusIcon} class="icon" />{/if}{features.label}</span
      >
    {/if}
    {#if !visible}
      <!-- Controls mount near the viewport. -->
    {:else if managers}
      <LangSwitch
        label="Package manager"
        value={$packageManager}
        options={MANAGERS}
        on:change={(event) => packageManager.set(event.detail)}
      />
      <span class="divider" aria-hidden="true"></span>
    {:else if canSwitch}
      <LangSwitch
        label="Code language"
        value={wantsTs ? "ts" : "js"}
        options={[
          { value: "js", label: "JS", title: "JavaScript" },
          { value: "ts", label: "TS", title: "TypeScript" },
        ]}
        on:change={(event) => codeLanguage.set(event.detail)}
      />
      <span class="divider" aria-hidden="true"></span>
    {/if}
    {#if visible && playground}
      <button type="button" class="action" title="Open in Svelte Playground" aria-label="Open in Svelte Playground" on:click={openPlayground}
        ><Launch /></button
      >
    {/if}
    {#if visible && features.copy}<CopyButton text={copyText} iconDescription="Copy code" />{/if}
  </div>
  {#snippet line(text, i)}<span
      class="line"
      data-highlight={features.marks.get(i + 1)?.has("highlight") ? "" : undefined}
      data-ins={features.marks.get(i + 1)?.has("ins") ? "" : undefined}
      data-del={features.marks.get(i + 1)?.has("del") ? "" : undefined}
      data-focus={features.marks.get(i + 1)?.has("focus") ? "" : undefined}
      data-output={isOutput(i + 1) ? "" : undefined}
      data-diff-header={features.plain.has(i + 1) ? "" : undefined}
      data-target={isTarget(i) ? "" : undefined}
      >{#if features.lineNumbers !== undefined && visible}<a
          class="line-number"
          href="#{blockId}-L{firstNumber + i}"
          tabindex="-1"
          aria-hidden="true"
          title="Copy a link to line {firstNumber + i}. Shift-click for a range."
          on:click={(event) => linkLine(event, i)}>{firstNumber + i}</a
        >{/if}{#if features.terminal?.prompts.has(i + 1)}<span class="prompt" aria-hidden="true">{"$ "}</span>{/if}{#if ansiHtml[i]}<span class="text" data-line={i}>{@html ansiHtml[i]}</span
        >{:else}<span class="text" data-line={i}>{text}</span>{/if}{#if features.terminal?.prompts.has(i + 1) && visible}<button
          type="button"
          class="line-copy"
          class:copied={copied === i}
          aria-label="Copy command: {commandText(i)}"
          on:click={() => copyCommand(i)}
          >{#if copied === i}<Checkmark />{:else}<Copy />{/if}</button
        >{/if}</span
    >{/snippet}
  <div class="body" class:collapsible class:collapsed>
    <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
    <pre
      bind:this={preEl}
      class:ready={visible}
      id="code-{uid}"
      role={files ? "tabpanel" : "group"}
      aria-labelledby={files ? `tab-${uid}-${active}` : undefined}
      data-codeview
      data-line-numbers={features.lineNumbers}
      data-wrap={features.wrap ? "" : undefined}
      data-has-focus={hasFocus ? "" : undefined}
      data-terminal={features.terminal ? "" : undefined}
      tabindex="0"
      aria-label={files ? undefined : `${features.title ?? label} code`}
      aria-describedby="hint-{uid}"
      on:pointerenter={() => (intel = true)}
      on:focusin={() => (intel = true)}
      on:pointermove={onPointerMove}
      on:pointerleave={() => {
        lastPointer = undefined;
        hide();
      }}
      on:keydown={onKeydown}
      on:blur={() => hide(0)}
    ><code bind:this={codeEl} style:counter-reset={features.lineNumbers === undefined ? undefined : `line ${features.lineNumbers - 1}`}
      >{#each collapsible ? lines.slice(0, maxCollapsedLines) : lines as text, i}{#if folds.has(i)}{@const fold = folds.get(i)}{#if i > 0}{"\n"}{/if}<span
            class="line fold-summary"
            ><button type="button" class="fold-toggle" aria-expanded={openFolds.has(fold.index)} on:click={() => toggleFold(fold.index)}
              ><ChevronDown class="fold-icon" />{`${openFolds.has(fold.index) ? "Hide" : "Show"} ${fold.end - i} ${fold.end - i === 1 ? "line" : "lines"}`}</button
            ></span
          >{/if}{#if !hiddenLines.has(i)}{#if i > 0 || folds.has(i)}{"\n"}{/if}{@render line(text, i)}{/if}{/each}{#if collapsible}<span
          class="tail"
          use:untilFound={collapsed}
          on:beforematch={() => (expanded = true)}
          >{#each lines.slice(maxCollapsedLines, maxCollapsedLines + tailRendered) as text, j}{"\n"}{@render line(text, maxCollapsedLines + j)}{/each}</span
        >{/if}</code
    ></pre>
    {#if collapsible}
      <div class="more">
        <Button kind="ghost" size="small" icon={ChevronDown} aria-expanded={expanded} aria-controls="code-{uid}" on:click={toggle}>
          {expanded ? "Show less" : `Show ${lines.length - maxCollapsedLines} more lines`}
        </Button>
      </div>
    {/if}
  </div>
  <span class="visually-hidden" id="hint-{uid}">Left and right arrow keys step through symbols with details.</span>
  <span class="visually-hidden" role="status">{announcement}</span>
</div>

<style>
  .codeview {
    color: var(--cds-text-01);
    max-width: var(--demo-measure, 40.75rem);
    border: 1px solid var(--cds-ui-03);
    background: var(--cds-ui-01);
  }

  .bar {
    display: flex;
    min-height: 2.5rem;
    align-items: center;
    gap: 0;
    padding-inline-start: var(--cds-spacing-05);
    border-bottom: 1px solid var(--cds-ui-03);
  }

  .bar.tabbed {
    padding-inline-start: 0;
  }

  .body {
    position: relative;
  }

  /* Room for the toggle under the last line. */
  .collapsible pre {
    padding-bottom: 3rem;
  }

  /* Collapsed: the tail is out of layout until shown or found. */
  .body :global(.tail[hidden]) {
    display: block;
    content-visibility: hidden;
  }

  .body :global(.tail:not([hidden])) {
    display: contents;
  }

  .more {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    justify-content: flex-end;
    padding: var(--cds-spacing-03);
    pointer-events: none;
  }

  .collapsed .more {
    padding-top: var(--cds-spacing-09);
    background: linear-gradient(to bottom, transparent, var(--cds-ui-01) 60%);
  }

  .more :global(.bx--btn) {
    pointer-events: auto;
  }

  .more :global(.bx--btn__icon) {
    transition: transform 110ms cubic-bezier(0.2, 0, 0.38, 0.9);
  }

  .body:not(.collapsed) .more :global(.bx--btn__icon) {
    transform: rotate(180deg);
  }

  .lang {
    display: inline-flex;
    align-items: center;
    gap: var(--cds-spacing-03);
    margin-inline-end: auto;
    color: var(--cds-text-02);
    font-size: 0.75rem;
    letter-spacing: 0.32px;
  }

  .lang :global(.icon),
  .status :global(.icon) {
    flex: none;
    fill: currentColor;
  }

  /* A status sits after the name: an icon in its support color, a label,
     and a 2px top edge, so it never rests on color alone. */
  .lang:has(+ .status) {
    margin-inline-end: 0;
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: var(--cds-spacing-02);
    margin-inline: var(--cds-spacing-05) auto;
    color: var(--cds-text-01);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.32px;
  }

  .status :global(.icon) {
    color: var(--code-kind);
  }

  /* Sized like CopyButton, its neighbor. */
  .action {
    display: inline-flex;
    width: 2.5rem;
    height: 2.5rem;
    flex: none;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--cds-icon-01, var(--cds-text-01));
    cursor: pointer;
    fill: currentColor;
  }

  .action:hover {
    background-color: var(--cds-hover-ui);
  }

  .action:focus-visible {
    outline: 2px solid var(--cds-focus);
    outline-offset: -2px;
  }

  .type-errors {
    border: 0;
    background: none;
    cursor: pointer;
    font-family: inherit;
  }

  .type-errors:hover {
    text-decoration: underline;
  }

  .type-errors:focus-visible {
    outline: 2px solid var(--cds-focus);
    outline-offset: 2px;
  }

  .type-errors :global(.icon) {
    color: var(--cds-support-01);
  }

  .codeview[data-kind] {
    border-top: 2px solid var(--code-kind);
  }

  .lang.title {
    color: var(--cds-text-01);
    font-family: "IBM Plex Mono", monospace;
  }

  /* Sets the switch apart from the copy action: room on both sides, and
     as tall as an icon, so it separates without adding weight. */
  .divider {
    flex: none;
    width: 1px;
    height: 1rem;
    margin-inline: var(--cds-spacing-03);
    background-color: var(--cds-ui-03);
  }

  pre {
    --code-pad: var(--code-gap, var(--cds-spacing-05));
    margin: 0;
    padding: var(--code-pad) 0;
    overflow-x: auto;
    color: var(--cds-text-01);
    font: var(--code-font-size, 0.875rem) / var(--code-line-height, 1.43) "IBM Plex Mono", monospace;
    tab-size: 2;
  }

  /* A folded section: a quiet row that reads as part of the code. */
  .fold-summary {
    color: var(--cds-text-02);
  }

  .fold-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--cds-spacing-02);
    margin: 0;
    padding: 0 var(--cds-spacing-02);
    border: 0;
    background: color-mix(in srgb, var(--cds-interactive-04) 6%, var(--code-band-base));
    color: inherit;
    cursor: pointer;
    font: inherit;
    fill: currentColor;
  }

  .fold-toggle:hover {
    background-color: var(--cds-hover-ui);
    color: var(--cds-text-01);
  }

  .fold-toggle:focus-visible {
    outline: 2px solid var(--cds-focus);
    outline-offset: -2px;
  }

  .fold-toggle :global(.fold-icon) {
    transform: rotate(-90deg);
    transition: transform 110ms cubic-bezier(0.2, 0, 0.38, 0.9);
  }

  .fold-toggle[aria-expanded="true"] :global(.fold-icon) {
    transform: none;
  }

  /* Diff headers (`@@ … @@`): context, not code. */
  pre :global(.line[data-diff-header]) {
    color: var(--cds-text-helper);
  }

  /* Line numbers become links near the viewport: the generated ones give way. */
  pre.ready :global(.line::before) {
    content: none;
  }

  .line-number {
    position: absolute;
    left: var(--code-pad);
    width: 3ch;
    color: var(--cds-text-helper);
    text-align: right;
    text-decoration: none;
    user-select: none;
  }

  .line-number:hover {
    color: var(--cds-text-01);
    text-decoration: underline;
  }

  :global(.line[data-target]) > .line-number {
    color: var(--cds-text-01);
    font-weight: 600;
  }

  /* One copy button per terminal command, shown on hover or focus. */
  .line-copy {
    position: absolute;
    top: 50%;
    right: var(--cds-spacing-03);
    display: inline-flex;
    width: 1.5rem;
    height: 1.5rem;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--cds-icon-02, var(--cds-text-02));
    cursor: pointer;
    fill: currentColor;
    opacity: 0;
    transform: translateY(-50%);
  }

  :global(.line:hover) > .line-copy,
  .line-copy:focus-visible,
  .line-copy.copied {
    opacity: 1;
  }

  .line-copy:hover {
    background-color: var(--cds-hover-ui);
    color: var(--cds-text-01);
  }

  .line-copy:focus-visible {
    outline: 2px solid var(--cds-focus);
    outline-offset: -2px;
  }

  @media (hover: none) {
    .line-copy {
      opacity: 1;
    }
  }

  .visually-hidden {
    position: absolute;
    overflow: hidden;
    width: 1px;
    height: 1px;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  pre:focus-visible {
    outline: 2px solid var(--cds-focus);
    outline-offset: -2px;
  }
</style>
