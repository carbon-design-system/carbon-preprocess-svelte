/**
 * Line-level features for fenced code, in the syntaxes docs sites already
 * use, so existing Markdown works unchanged:
 *
 * - Fence metadata (Docusaurus, VitePress, Expressive Code):
 *   ```svelte title="+page.svelte" {2,4-6} ins={8} del={7} focus={2-6} showLineNumbers
 * - Inline markers at a line's end (Shiki/VitePress), removed from the
 *   output: `// [!code highlight]`, `// [!code ++]`, `// [!code --]`,
 *   `// [!code focus]`, with an optional line count (`[!code focus:3]`).
 * - Terminal sessions: in `sh`/`bash`/`shell`/`console`, lines starting
 *   with `$ ` are commands; the others are output.
 */
import { type AnsiStyle, ansiToHtml, stripAnsi } from "./ansi";
import { escapeText } from "./inline";

export type LineMark = "highlight" | "ins" | "del" | "focus";

/** A block's status, shown in its header with an icon and a label. */
export type CodeKind = "error" | "warning" | "success" | "info";

export interface CodeMeta {
  /** A file name or caption, from `title="…"` or `[label]` (VitePress). */
  title?: string;
  /** Marks by 1-based line number. */
  marks: Map<number, Set<LineMark>>;
  /** The first line number, when line numbers are on. */
  lineNumbers?: number;
  /** Soft-wrap long lines instead of scrolling. */
  wrap: boolean;
  /** A status: `kind="error"` (or `warning`, `success`, `info`). `do` and `dont` set it too. */
  kind?: CodeKind;
  /** The status label: `label="Deprecated"`. Defaults to the kind, or "Do" and "Don't". */
  label?: string;
  /** Whether to offer copying: off for `dont` blocks unless the fence says `copy`. */
  copy: boolean;
  /** A Prose variant for this block's type and spacing: `variant="compact"`. */
  variant?: string;
  /** A Carbon theme for this block alone: `theme="g100"`. */
  theme?: string;
  /** An icon to use instead of the file's default: `icon="LogoPython"`. */
  icon?: string;
  /**
   * `iconOnly`: a header with the file's or language's icon and no visible
   * name (the name stays for screen readers).
   */
  iconOnly: boolean;
}

const META_TOKEN =
  /[\w-]+=(?:"[^"]*"|'[^']*'|\{[^}]*\}|\S+)|\{[^}]*\}|\[[^\]]*\]|\S+/g;
const RANGES = /^\{([\d,\s-]*)\}$/;
const KEYED_RANGES =
  /^(mark|highlight|hl|ins|add|del|remove|focus)=\{([\d,\s-]*)\}$/;
const LABEL = /^\[([^\]]*)\]$/;
const TITLE = /^(?:title|filename|file)=(?:"([^"]*)"|'([^']*)'|(\S+))$/;
const LINE_NUMBERS =
  /^(?:showLineNumbers|lineNumbers|line-numbers)(?:=\{?(\d+)\}?)?$/;
const WRAP = /^(?:wrap|wordWrap)$/;
const VALUE = /^(kind|label|variant|theme|icon)=(?:"([^"]*)"|'([^']*)'|(\S+))$/;
const DO = /^do$/;
const DONT = /^(?:dont|don't|do-not)$/;
const COPY = /^(copy|nocopy|no-copy)$/;
const ICON_ONLY = /^(?:iconOnly|icon-only)$/;
const KINDS = new Set<string>(["error", "warning", "success", "info"]);
const KIND_LABELS: Record<CodeKind, string> = {
  error: "Error",
  warning: "Warning",
  success: "Success",
  info: "Note",
};
const MARKER =
  /[ \t]*(?:\/\/|\/\*|<!--|#|--)[ \t]*\[!code (highlight|hl|\+\+|--|focus)(?::(\d+))?\][ \t]*(?:\*\/|-->)?[ \t]*$/;
const SHELL = new Set(["sh", "bash", "shell", "zsh", "console", "terminal"]);
const PROMPT = /^\$ /;
const TAG_OR_NEWLINE = /<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>|\n/g;
const CODE_CONTENT =
  /^\s*<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*)<\/code>\s*<\/pre>\s*$/;
const FINAL_NEWLINE = /\n$/;

const KEYS: Record<string, LineMark> = {
  mark: "highlight",
  highlight: "highlight",
  hl: "highlight",
  ins: "ins",
  add: "ins",
  del: "del",
  remove: "del",
  focus: "focus",
};
const MARKERS: Record<string, LineMark> = {
  highlight: "highlight",
  hl: "highlight",
  "++": "ins",
  "--": "del",
  focus: "focus",
};

function addMark(
  marks: Map<number, Set<LineMark>>,
  line: number,
  mark: LineMark,
) {
  if (!marks.has(line)) marks.set(line, new Set());
  marks.get(line)?.add(mark);
}

/** `1,3-5` -> 1, 3, 4, 5. */
function* lineRange(text: string): Generator<number> {
  for (const part of text.split(",")) {
    const [from, to = from] = part.trim().split("-").map(Number);
    if (!Number.isInteger(from) || !Number.isInteger(to)) continue;
    for (let line = from; line <= Math.min(to, from + 9999); line++) yield line;
  }
}

/** Parse a fence's metadata (the text after its language). */
export function parseCodeMeta(meta: string): CodeMeta {
  const result: CodeMeta = {
    marks: new Map(),
    wrap: false,
    copy: true,
    iconOnly: false,
  };
  let copy: boolean | undefined;
  for (const [token] of meta.matchAll(META_TOKEN)) {
    const ranges = RANGES.exec(token);
    const keyed = KEYED_RANGES.exec(token);
    const title = TITLE.exec(token) ?? LABEL.exec(token);
    const numbers = LINE_NUMBERS.exec(token);
    if (ranges) {
      for (const line of lineRange(ranges[1]))
        addMark(result.marks, line, "highlight");
    } else if (keyed) {
      for (const line of lineRange(keyed[2]))
        addMark(result.marks, line, KEYS[keyed[1]]);
    } else if (title) {
      result.title = title[1] ?? title[2] ?? title[3];
    } else if (numbers) {
      result.lineNumbers = numbers[1] ? Number(numbers[1]) : 1;
    } else if (WRAP.test(token)) {
      result.wrap = true;
    } else if (DO.test(token)) {
      result.kind = "success";
      result.label ??= "Do";
    } else if (DONT.test(token)) {
      result.kind = "error";
      result.label ??= "Don't";
      copy ??= false;
    } else if (ICON_ONLY.test(token)) {
      result.iconOnly = true;
    } else if (COPY.test(token)) {
      copy = token === "copy";
    } else {
      const value = VALUE.exec(token);
      if (!value) continue;
      const text = value[2] ?? value[3] ?? value[4];
      if (value[1] === "kind") {
        if (KINDS.has(text)) result.kind = text as CodeKind;
      } else {
        result[value[1] as "label" | "variant" | "theme" | "icon"] = text;
      }
    }
  }
  if (result.kind) result.label ??= KIND_LABELS[result.kind];
  result.copy = copy ?? true;
  return result;
}

/**
 * Remove `[!code …]` markers from the ends of lines, adding their marks to
 * `marks`. Returns the code without them.
 */
export function stripCodeMarkers(
  code: string,
  marks: Map<number, Set<LineMark>>,
): string {
  const lines = code.split("\n");
  return lines
    .map((line, index) => {
      const match = MARKER.exec(line);
      if (!match) return line;
      const count = match[2] ? Number(match[2]) : 1;
      for (let i = 0; i < count; i++)
        addMark(marks, index + 1 + i, MARKERS[match[1]]);
      return line.slice(0, match.index);
    })
    .join("\n");
}

export interface TerminalLines {
  /** 1-based lines that are commands: `$ ` lines (prompt removed) and their `\` continuations. */
  commands: Set<number>;
  /** 1-based lines that had a `$ ` prompt: where each command starts. */
  prompts: Set<number>;
  /** The code without prompts. */
  code: string;
}

/** For a shell session with `$ ` prompts: which lines are commands. */
export function terminalLines(
  code: string,
  lang: string,
): TerminalLines | undefined {
  if (!SHELL.has(lang.toLowerCase())) return undefined;
  const lines = code.split("\n");
  if (!lines.some((line) => PROMPT.test(line))) return undefined;
  const commands = new Set<number>();
  const prompts = new Set<number>();
  let continued = false;
  const stripped = lines.map((line, index) => {
    const prompt = PROMPT.test(line);
    // A command continues past a line ending in `\`.
    if (!prompt && !continued) return line;
    commands.add(index + 1);
    if (prompt) prompts.add(index + 1);
    continued = line.endsWith("\\");
    return prompt ? line.slice(2) : line;
  });
  return { commands, prompts, code: stripped.join("\n") };
}

/**
 * Split highlighted HTML into lines, closing the elements open at each line
 * break and reopening them on the next line, so every line is balanced.
 */
export function splitHtmlLines(html: string): string[] {
  const lines: string[] = [];
  const open: { name: string; tag: string }[] = [];
  let line = "";
  let last = 0;
  for (const match of html.matchAll(TAG_OR_NEWLINE)) {
    const index = match.index ?? 0;
    line += html.slice(last, index);
    last = index + match[0].length;
    if (match[0] === "\n") {
      line += open
        .map((o) => `</${o.name}>`)
        .reverse()
        .join("");
      lines.push(line);
      line = open.map((o) => o.tag).join("");
      continue;
    }
    line += match[0];
    if (match[3] === "/") continue;
    if (match[1] === "/") open.pop();
    else open.push({ name: match[2], tag: match[0] });
  }
  lines.push(line + html.slice(last));
  return lines;
}

export interface RenderedCode {
  /** The inside of `<code>`: one `<span class="line">` per line. */
  html: string;
  /** Text for a copy button: commands without prompts, no output, no deleted lines. */
  copy: string;
  /** Attributes for the `<pre>`. */
  attributes: Record<string, string>;
}

/**
 * Render code lines with their marks. `highlight` turns code into HTML (or
 * returns `undefined` for plain, escaped text). Returns `undefined` when the
 * code has no line features, so plain blocks keep their simpler output.
 */
export async function renderCodeLines(
  value: string,
  lang: string,
  metaText: string,
  highlight?: (
    code: string,
  ) => string | undefined | Promise<string | undefined>,
): Promise<(RenderedCode & { meta: CodeMeta }) | undefined> {
  const meta = parseCodeMeta(metaText);
  const original = value.replace(FINAL_NEWLINE, "");
  const marked = stripCodeMarkers(original, meta.marks);
  const terminal = terminalLines(marked, lang);
  const ansi = lang.toLowerCase() === "ansi";
  const hasFeatures =
    meta.marks.size > 0 ||
    meta.lineNumbers !== undefined ||
    meta.wrap ||
    meta.title !== undefined ||
    meta.kind !== undefined ||
    meta.iconOnly ||
    meta.variant !== undefined ||
    meta.theme !== undefined ||
    ansi ||
    terminal ||
    marked !== original;
  if (!hasFeatures) return undefined;

  const code = terminal?.code ?? marked;
  const highlighted = await highlight?.(code);
  // A highlighter that returns a whole `<pre>` (Shiki): keep its `<code>` content.
  const inner = highlighted
    ? (CODE_CONTENT.exec(highlighted)?.[1] ?? highlighted)
    : undefined;
  const lines = splitHtmlLines(inner ?? escapeText(code));
  const source = code.split("\n");
  const hasFocus = [...meta.marks.values()].some((set) => set.has("focus"));
  // ANSI colors in terminal output (or a whole `ansi` block) carry from line to line.
  let ansiStyle: AnsiStyle = {};
  const ansiLine = (line: string) => {
    const result = ansiToHtml(line, { literals: ansi, style: ansiStyle });
    ansiStyle = result.style;
    return result.html;
  };
  const html = lines
    .map((content, index) => {
      const number = index + 1;
      const marks = meta.marks.get(number);
      const attributes = [...(marks ?? [])]
        .map((mark) => ` data-${mark}`)
        .join("");
      const command = terminal?.commands.has(number);
      const output = terminal && !command ? " data-output" : "";
      const prompt = terminal?.prompts.has(number)
        ? '<span class="prompt" aria-hidden="true">$ </span>'
        : "";
      // Output isn't shell syntax: show it as plain text, in its ANSI colors.
      const text = ansi || output ? ansiLine(source[index] ?? "") : content;
      return `<span class="line"${attributes}${output}>${prompt}${text}</span>`;
    })
    .join("\n");
  const copy = source
    .filter((_, index) => {
      const number = index + 1;
      if (meta.marks.get(number)?.has("del")) return false;
      return !terminal || terminal.commands.has(number);
    })
    .map((line) => (ansi ? stripAnsi(line, true) : line))
    .join("\n");
  const attributes: Record<string, string> = {};
  if (meta.lineNumbers !== undefined)
    attributes["data-line-numbers"] = String(meta.lineNumbers);
  if (meta.wrap) attributes["data-wrap"] = "";
  if (hasFocus) attributes["data-has-focus"] = "";
  if (terminal) attributes["data-terminal"] = "";
  if (ansi) attributes["data-ansi"] = "";
  if (meta.variant) attributes["data-variant"] = meta.variant;
  return { html, copy, attributes, meta };
}
