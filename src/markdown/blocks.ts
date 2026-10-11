import {
  type LinkReference,
  normalizeLabel,
  normalizeUrl,
  parseDestination,
  parseTitle,
  unescapeString,
} from "./inline";
import { type ScannedTag, scanElement, scanTag, skipExpression } from "./scan";

export type AlertType = "note" | "tip" | "important" | "warning" | "caution";
export type Align = "left" | "center" | "right" | null;

/** Extra attributes a `transform` hook can set on the rendered element. */
export type Attributes = Record<string, string>;

export type Block =
  | {
      type: "heading";
      depth: number;
      /** Inline Markdown source. */
      text: string;
      id?: string;
      attrs?: Attributes;
    }
  | { type: "paragraph"; text: string; attrs?: Attributes }
  | { type: "code"; lang: string; meta: string; value: string }
  /**
   * Code blocks that belong together. `::: code-group` (VitePress) shows
   * them as tabs, labeled by their `[label]` or `title="…"`; `::: compare`
   * shows them side by side, such as a `dont` block and a `do` block. Other
   * blocks inside are kept. `group="svelte"` (on `code-group`) syncs the
   * selected tab with every other group of that name, by label.
   */
  | {
      type: "codeGroup";
      layout: "tabs" | "compare";
      group?: string;
      children: Block[];
    }
  | { type: "thematicBreak" }
  | { type: "blockquote"; children: Block[]; alert?: AlertType }
  | {
      type: "list";
      ordered: boolean;
      start: number;
      tight: boolean;
      items: ListItem[];
    }
  | { type: "table"; align: Align[]; head: string[]; rows: string[][] }
  /** Svelte markup (elements, components, `{#if}` lines), kept verbatim. */
  | { type: "svelte"; value: string };

export interface ListItem {
  /** `true`/`false` for a task list item (`- [x]`), otherwise undefined. */
  checked?: boolean;
  children: Block[];
}

const FENCE = /^(`{3,}|~{3,})(.*)$/;
const CODE_GROUP =
  /^:{3,}[ \t]*(code-group|compare)(?:[ \t]+group=(?:"([^"]*)"|'([^']*)'|(\S+)))?[ \t]*$/;
const CONTAINER_END = /^:{3,}[ \t]*$/;
const ATX = /^(#{1,6})(?=[ \t]|$)(.*)$/;
const ATX_CLOSING = /(?:^|[ \t]+)#+[ \t]*$/;
const THEMATIC_BREAK = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const SETEXT = /^(?:=+|-+)[ \t]*$/;
const BULLET = /^([*+-])(?=[ \t]|$)/;
const ORDERED = /^(\d{1,9})([.)])(?=[ \t]|$)/;
const TABLE_DELIMITER_CELL = /^:?-+:?$/;
const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;
const TASK = /^\[([ xX])\](?=[ \t])[ \t]*/;
const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
const SVELTE_START = /^(?:<(?:[A-Za-z]|!--)|\{[#:/@])/;
const SVELTE_INTERRUPT = /^(?:<\/?([A-Za-z][\w-]*)|\{[#:/])/;
const UNESCAPED_PIPE = /(?<!\\)\|/;
const ESCAPED_PIPE = /\\\|/g;
const BLANK = /^[ \t]*$/;
const SPACE_OR_TAB = /[ \t]/;
const TRAILING_WHITESPACE = /[ \t]+$/;
const LEADING_WHITESPACE = /^[ \t]+/;

/** CommonMark block-level HTML tags (type 6): these may interrupt a paragraph. */
const BLOCK_TAGS = new Set(
  "address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul pre script style textarea".split(
    " ",
  ),
);

const ALERTS: Record<string, AlertType> = {
  NOTE: "note",
  TIP: "tip",
  IMPORTANT: "important",
  WARNING: "warning",
  CAUTION: "caution",
};

export interface BlockContext {
  refs: Map<string, LinkReference>;
  /** Footnote definitions (`[^label]: …`), by lowercased label. */
  footnotes: Map<string, Block[]>;
}

interface ParsedBlocks {
  blocks: Block[];
  /** A blank line separated two blocks at this level (makes a list loose). */
  gap: boolean;
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || BLANK.test(line);
}

/** Width of the leading whitespace in columns, with tabs to 4-column stops. */
function indentOf(line: string): number {
  let col = 0;
  for (const c of line) {
    if (c === " ") col++;
    else if (c === "\t") col += 4 - (col % 4);
    else break;
  }
  return col;
}

/** Remove up to `n` columns of leading whitespace. */
function stripColumns(line: string, n: number): string {
  let col = 0;
  let i = 0;
  while (i < line.length && col < n) {
    const c = line[i];
    if (c === " ") {
      col++;
    } else if (c === "\t") {
      const width = 4 - (col % 4);
      if (col + width > n)
        return " ".repeat(col + width - n) + line.slice(i + 1);
      col += width;
    } else {
      break;
    }
    i++;
  }
  return line.slice(i);
}

interface Marker {
  ordered: boolean;
  /** Bullet character or ordered delimiter, which siblings must share. */
  kind: string;
  start: number;
  /** Column where the item's content starts. */
  contentIndent: number;
  content: string;
}

function listMarker(line: string): Marker | null {
  const indent = indentOf(line);
  if (indent > 3) return null;
  const rest = stripColumns(line, indent);
  const bullet = BULLET.exec(rest);
  const ordered = bullet ? null : ORDERED.exec(rest);
  const match = bullet ?? ordered;
  if (!match) return null;
  const markerWidth = match[0].length;
  const after = rest.slice(markerWidth);
  const spaces = indentOf(after);
  const blank = isBlank(after);
  const padding = blank || spaces > 4 ? 1 : spaces;
  return {
    ordered: !bullet,
    kind: bullet ? match[1] : match[2],
    start: ordered ? Number(match[1]) : 1,
    contentIndent: indent + markerWidth + padding,
    content: blank ? "" : stripColumns(after, padding),
  };
}

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  return row
    .split(UNESCAPED_PIPE)
    .map((cell) => cell.trim().replace(ESCAPED_PIPE, "|"));
}

function tableAlign(line: string | undefined): Align[] | null {
  if (line === undefined || !line.includes("|") || indentOf(line) > 3) {
    return null;
  }
  const cells = splitRow(line);
  if (!cells.every((cell) => TABLE_DELIMITER_CELL.test(cell))) return null;
  return cells.map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : null;
  });
}

/** Whether `line` starts a block that ends an open paragraph. */
function interruptsParagraph(line: string): boolean {
  if (indentOf(line) > 3) return false;
  const rest = line.trimStart();
  if (
    FENCE.test(rest) ||
    CODE_GROUP.test(rest) ||
    ATX.test(rest) ||
    THEMATIC_BREAK.test(rest) ||
    rest.startsWith(">")
  ) {
    return true;
  }
  const marker = listMarker(line);
  if (marker)
    return marker.content !== "" && (!marker.ordered || marker.start === 1);
  const svelte = SVELTE_INTERRUPT.exec(rest);
  return (
    svelte !== null &&
    (svelte[1] === undefined || BLOCK_TAGS.has(svelte[1].toLowerCase()))
  );
}

/**
 * Link reference definitions at the start of a paragraph. Returns the
 * paragraph text left over.
 */
function extractReferences(
  text: string,
  refs: Map<string, LinkReference>,
): string {
  let rest = text;
  while (rest.startsWith("[")) {
    const close = findLabelEnd(rest);
    if (close < 0 || rest[close + 1] !== ":") break;
    const label = rest.slice(1, close);
    if (label.trim() === "") break;
    let i = skipWhitespace(rest, close + 2);
    const dest = parseDestination(rest, i);
    if (!dest || (dest.value === "" && rest[i] !== "<")) break;
    i = dest.end;
    const afterDest = i;
    let title = "";
    let end = lineEnd(rest, afterDest);
    i = skipWhitespace(rest, i);
    const parsedTitle = i > afterDest ? parseTitle(rest, i) : null;
    if (parsedTitle && lineEnd(rest, parsedTitle.end) >= 0) {
      title = parsedTitle.value;
      end = lineEnd(rest, parsedTitle.end);
    } else if (end < 0) {
      break;
    }
    const key = normalizeLabel(label);
    if (!refs.has(key)) {
      refs.set(key, {
        href: normalizeUrl(unescapeString(dest.value)),
        title: unescapeString(title),
      });
    }
    rest = rest.slice(end);
  }
  return rest;
}

function findLabelEnd(text: string): number {
  for (let i = 1; i < text.length && i < 1001; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "[") return -1;
    else if (c === "]") return i;
  }
  return -1;
}

function skipWhitespace(text: string, i: number): number {
  let newlines = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\n") {
      if (++newlines > 1) break;
    } else if (c !== " " && c !== "\t") {
      break;
    }
    i++;
  }
  return i;
}

/** Index past the end of the line at `i` if only spaces remain on it, else -1. */
function lineEnd(text: string, i: number): number {
  while (text[i] === " " || text[i] === "\t") i++;
  if (i === text.length) return i;
  return text[i] === "\n" ? i + 1 : -1;
}

/** Parse lines into blocks. Containers (quotes, list items) recurse. */
export function parseBlocks(lines: string[], ctx: BlockContext): ParsedBlocks {
  const blocks: Block[] = [];
  const source = lines.join("\n");
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }

  let paragraph: string[] = [];
  let gap = false;
  let blankBefore = false;
  let i = 0;

  const add = (block: Block) => {
    if (blankBefore && blocks.length > 0) gap = true;
    blankBefore = false;
    blocks.push(block);
  };
  const flush = () => {
    if (paragraph.length === 0) return;
    const text = extractReferences(
      paragraph.join("\n").replace(TRAILING_WHITESPACE, ""),
      ctx.refs,
    );
    paragraph = [];
    if (text.trim() !== "") add({ type: "paragraph", text });
  };
  /** Index of the line holding source offset `at`. */
  const lineOf = (at: number) => {
    let low = i;
    let high = lines.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (offsets[mid] <= at) low = mid;
      else high = mid - 1;
    }
    return low;
  };
  /** Offset just past the element or expression at `at`, or -1. */
  const markupEnd = (at: number) =>
    source[at] === "{" ? skipExpression(source, at) : scanElement(source, at);

  /**
   * Like a CommonMark HTML block, a Svelte block runs to the next blank
   * line, but blank lines inside an element or expression don't end it.
   * Returns the block's last line.
   */
  const blockEnd = (first: number, from: number): number => {
    let line = first;
    let pos = from;
    for (;;) {
      const stop = offsets[line] + lines[line].length;
      if (pos >= stop) {
        if (line + 1 >= lines.length || isBlank(lines[line + 1])) return line;
        line++;
        pos = offsets[line];
        continue;
      }
      const c = source[pos];
      const end = c === "<" || c === "{" ? markupEnd(pos) : -1;
      if (end < 0) {
        pos++;
        continue;
      }
      pos = end;
      if (end > stop) line = lineOf(end - 1);
    }
  };

  /**
   * Last line of the Svelte block starting on line `i`; `"text"` when the
   * line is a paragraph that opens with inline markup, or `"unclosed"`.
   */
  const svelteBlockEnd = (rest: string): number | "text" | "unclosed" => {
    const start = offsets[i] + (lines[i].length - rest.length);
    let tag: ScannedTag | null = null;
    if (source[start] === "<" && !source.startsWith("<!--", start)) {
      tag = scanTag(source, start);
      if (!tag || tag.closing) return "text";
    }
    const end = markupEnd(start);
    const lineStop = offsets[i] + lines[i].length;
    if (end < 0) {
      // Like CommonMark, an unclosed tag starts a block only when nothing
      // but whitespace follows it on its line.
      const after = tag ? source.slice(tag.end, lineStop) : "";
      return after.trim() === "" ? "unclosed" : "text";
    }
    if (end <= lineStop) {
      const tail = source.slice(end, lineStop).trimStart();
      if (tail !== "" && tail[0] !== "<" && tail[0] !== "{") return "text";
    }
    return blockEnd(lineOf(end - 1), end);
  };

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      flush();
      blankBefore = true;
      i++;
      continue;
    }

    const indent = indentOf(line);
    const rest = indent > 3 ? line : stripColumns(line, indent);

    if (indent > 3) {
      // Indented code blocks are off: indentation belongs to Svelte markup.
      paragraph.push(line.replace(LEADING_WHITESPACE, ""));
      i++;
      continue;
    }

    if (paragraph.length > 0 && SETEXT.test(rest)) {
      const text = extractReferences(paragraph.join("\n"), ctx.refs);
      paragraph = [];
      if (text.trim() !== "") {
        add({
          type: "heading",
          depth: rest[0] === "=" ? 1 : 2,
          text: text.replace(TRAILING_WHITESPACE, ""),
        });
        i++;
        continue;
      }
    }

    // A table's header row may be the last line of an open paragraph.
    const align = rest.includes("|") ? tableAlign(lines[i + 1]) : null;
    if (align && splitRow(rest).length === align.length) {
      flush();
      const head = splitRow(rest);
      const rows: string[][] = [];
      i += 2;
      while (
        i < lines.length &&
        !isBlank(lines[i]) &&
        !interruptsParagraph(lines[i])
      ) {
        const cells = splitRow(lines[i]);
        rows.push(head.map((_, column) => cells[column] ?? ""));
        i++;
      }
      add({ type: "table", align, head, rows });
      continue;
    }

    if (paragraph.length > 0 && !interruptsParagraph(line)) {
      paragraph.push(rest);
      i++;
      continue;
    }
    flush();

    // A footnote definition: its first line, lazy continuation lines, and
    // any following blocks indented four columns. It renders at the end.
    const footnote = FOOTNOTE_DEF.exec(rest);
    if (footnote) {
      const body = [footnote[2]];
      i++;
      while (i < lines.length) {
        const current = lines[i];
        if (isBlank(current)) {
          let j = i;
          while (j < lines.length && isBlank(lines[j])) j++;
          if (j >= lines.length || indentOf(lines[j]) < 4) break;
          for (; i < j; i++) body.push("");
        } else if (indentOf(current) >= 4) {
          body.push(stripColumns(current, 4));
          i++;
        } else if (
          !isBlank(body.at(-1)) &&
          !interruptsParagraph(current) &&
          !FOOTNOTE_DEF.test(current.trimStart())
        ) {
          body.push(current.trimStart());
          i++;
        } else {
          break;
        }
      }
      const label = footnote[1].toLowerCase();
      if (!ctx.footnotes.has(label)) {
        ctx.footnotes.set(label, parseBlocks(body, ctx).blocks);
      }
      continue;
    }

    const group = CODE_GROUP.exec(rest);
    if (group) {
      const inner: string[] = [];
      let fenced = false;
      i++;
      while (i < lines.length) {
        const current = stripColumns(lines[i], indent);
        i++;
        if (!fenced && CONTAINER_END.test(current.trim())) break;
        if (FENCE.test(current.trimStart())) fenced = !fenced;
        inner.push(current);
      }
      add({
        type: "codeGroup",
        layout: group[1] === "compare" ? "compare" : "tabs",
        group: group[2] ?? group[3] ?? group[4],
        children: parseBlocks(inner, ctx).blocks,
      });
      continue;
    }

    const fence = FENCE.exec(rest);
    if (fence && !(fence[1][0] === "`" && fence[2].includes("`"))) {
      const marker = fence[1];
      const info = unescapeString(fence[2].trim());
      const space = info.search(SPACE_OR_TAB);
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const current = lines[i];
        const closing = current.trim();
        if (
          indentOf(current) < 4 &&
          closing.startsWith(marker) &&
          closing.replaceAll(marker[0], "") === ""
        ) {
          i++;
          break;
        }
        body.push(stripColumns(current, indent));
        i++;
      }
      add({
        type: "code",
        lang: space < 0 ? info : info.slice(0, space),
        meta: space < 0 ? "" : info.slice(space + 1).trim(),
        value: body.length > 0 ? `${body.join("\n")}\n` : "",
      });
      continue;
    }

    const atx = ATX.exec(rest);
    if (atx) {
      add({
        type: "heading",
        depth: atx[1].length,
        text: atx[2].replace(ATX_CLOSING, "").trim(),
      });
      i++;
      continue;
    }

    if (THEMATIC_BREAK.test(rest)) {
      add({ type: "thematicBreak" });
      i++;
      continue;
    }

    if (rest.startsWith(">")) {
      const inner: string[] = [];
      let fenced = false;
      while (i < lines.length) {
        const current = lines[i];
        const trimmed = current.trimStart();
        if (indentOf(current) < 4 && trimmed.startsWith(">")) {
          let content = trimmed.slice(1);
          if (content[0] === " ") content = content.slice(1);
          else if (content[0] === "\t") content = stripColumns(content, 2);
          inner.push(content);
          if (FENCE.test(content.trimStart())) fenced = !fenced;
          i++;
        } else if (
          !isBlank(current) &&
          !fenced &&
          !isBlank(inner.at(-1)) &&
          !interruptsParagraph(current)
        ) {
          inner.push(lazy(current));
          i++;
        } else {
          break;
        }
      }
      const children = parseBlocks(inner, ctx).blocks;
      const block: Block = { type: "blockquote", children };
      const first = children[0];
      const alert = first?.type === "paragraph" ? ALERT.exec(first.text) : null;
      if (alert && first?.type === "paragraph") {
        block.alert = ALERTS[alert[1].toUpperCase()];
        first.text = first.text.slice(alert[0].length);
        if (first.text.trim() === "") children.shift();
      }
      add(block);
      continue;
    }

    const marker = listMarker(line);
    if (marker) {
      const list = parseList(lines, i, marker, ctx);
      add(list.block);
      i = list.next;
      continue;
    }

    if (SVELTE_START.test(rest)) {
      const last = svelteBlockEnd(rest);
      if (typeof last === "number") {
        add({ type: "svelte", value: lines.slice(i, last + 1).join("\n") });
        i = last + 1;
        continue;
      }
      if (last === "unclosed") {
        // Unclosed: fall back to CommonMark, which ends it at a blank line.
        const start = i;
        while (i < lines.length && !isBlank(lines[i])) i++;
        add({ type: "svelte", value: lines.slice(start, i).join("\n") });
        continue;
      }
    }

    paragraph.push(rest);
    i++;
  }
  flush();
  return { blocks, gap };
}

function parseList(
  lines: string[],
  start: number,
  first: Marker,
  ctx: BlockContext,
): { block: Block; next: number } {
  const items: ListItem[] = [];
  let loose = false;
  let i = start;
  let marker: Marker | null = first;

  while (marker) {
    const content: string[] = [marker.content];
    const width = marker.contentIndent;
    let blanks = 0;
    i++;
    while (i < lines.length) {
      const line = lines[i];
      if (isBlank(line)) {
        // An item may start with at most one blank line.
        if (content.length === 1 && content[0] === "") break;
        content.push("");
        blanks++;
        i++;
        continue;
      }
      if (indentOf(line) >= width) {
        content.push(stripColumns(line, width));
        blanks = 0;
        i++;
        continue;
      }
      if (
        blanks > 0 ||
        listMarker(line) ||
        interruptsParagraph(line) ||
        !lastIsParagraphText(content)
      ) {
        break;
      }
      content.push(lazy(line));
      i++;
    }
    // Leave trailing blank lines to the caller.
    i -= blanks;
    content.length -= blanks;

    const parsed = parseBlocks(content, ctx);
    if (parsed.gap) loose = true;
    const item: ListItem = { children: parsed.blocks };
    const head = parsed.blocks[0];
    const task = head?.type === "paragraph" ? TASK.exec(head.text) : null;
    if (task && head?.type === "paragraph") {
      item.checked = task[1] !== " ";
      head.text = head.text.slice(task[0].length);
    }
    items.push(item);

    let j = i;
    while (j < lines.length && isBlank(lines[j])) j++;
    const next: Marker | null = j < lines.length ? listMarker(lines[j]) : null;
    if (
      next &&
      next.ordered === first.ordered &&
      next.kind === first.kind &&
      !THEMATIC_BREAK.test(lines[j].trim())
    ) {
      if (j > i) loose = true;
      i = j;
      marker = next;
    } else {
      marker = null;
    }
  }

  return {
    block: {
      type: "list",
      ordered: first.ordered,
      start: first.start,
      tight: !loose,
      items,
    },
    next: i,
  };
}

/**
 * A lazy continuation line, indented so the container's parser can only read
 * it as paragraph text (indented code is off), never as a setext underline
 * or the start of a block.
 */
function lazy(line: string): string {
  return `    ${line.trimStart()}`;
}

/** Whether a lazy continuation line could extend the item's last paragraph. */
function lastIsParagraphText(content: string[]): boolean {
  const last = content.at(-1);
  if (last === undefined || isBlank(last)) return false;
  let fenced = false;
  for (const line of content) {
    if (FENCE.test(line.trimStart())) fenced = !fenced;
  }
  return !fenced;
}

/** Parse a Markdown document (without frontmatter) into blocks. */
export function parseDocument(source: string): {
  blocks: Block[];
  refs: Map<string, LinkReference>;
  footnotes: Map<string, Block[]>;
} {
  const ctx: BlockContext = { refs: new Map(), footnotes: new Map() };
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  return { blocks: parseBlocks(lines, ctx).blocks, ...ctx };
}
