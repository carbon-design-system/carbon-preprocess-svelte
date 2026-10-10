import { scanTag, skipExpression } from "./scan";

/** A link reference definition, keyed by its normalized label. */
export interface LinkReference {
  href: string;
  title: string;
}

export interface InlineOptions {
  refs: ReadonlyMap<string, LinkReference>;
  /** Pass `{expression}` in text through to Svelte instead of escaping it. */
  expressions: boolean;
  /** Link bare `https://` and `www.` URLs (GFM autolink literals). */
  autolinks?: boolean;
  /**
   * Markup for a footnote reference (`[^label]`), or `undefined` when the
   * label has no definition and the text stays literal.
   */
  footnote?: (label: string) => string | undefined;
  /** Extra attributes for an image (`loading`, `width`), by its source. */
  image?: (src: string) => string;
}

type Inline =
  | { type: "text"; value: string }
  | { type: "raw"; value: string }
  | { type: "code"; value: string }
  | { type: "break" }
  | {
      type: "delim";
      char: string;
      count: number;
      length: number;
      canOpen: boolean;
      canClose: boolean;
    }
  | { type: "em" | "strong" | "del"; children: Inline[] }
  | {
      type: "link" | "image";
      href: string;
      title: string;
      children: Inline[];
    };

interface Bracket {
  /** Index of the `[` or `![` text node in the inline list. */
  index: number;
  /** Source offset just past the opening bracket. */
  start: number;
  image: boolean;
  active: boolean;
}

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const UNICODE_PUNCTUATION = /[\p{P}\p{S}]/u;
const UNICODE_WHITESPACE = /\s/u;
const SPECIAL = /[\\`*_~[\]!<&{}\n]/g;
const ENTITY =
  /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/y;
const AUTOLINK_URI = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>\p{Cc}]*)>/uy;
const AUTOLINK_EMAIL =
  /<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/y;
const CLOSING_TAG = /<\/[A-Za-z][\w.-]*(?::[\w.-]+)?\s*>/y;
const LINK_LABEL = /\[((?:[^\\[\]]|\\.){0,999})\]/y;
const TRAILING_SPACES = / +$/;
const WHITESPACE_RUN = /[ \t\r\n]+/g;
const BACKSLASH_ESCAPE = /\\([!-/:-@[-`{-~])/g;
const NUMERIC_ENTITY = /&#([xX]?)([0-9a-fA-F]+);/g;
const UNSAFE_URL_CHAR =
  /[^A-Za-z0-9\-._~:/?#@!$&'()*+,;=%]|%(?![0-9a-fA-F]{2})/g;
const ESCAPE_TEXT = /[&<>"{}]/g;
const URL_LITERAL = /(?:https?:\/\/|ftp:\/\/|www\.)[^\s<]+/g;
const EMAIL_LITERAL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const TRAILING_ENTITY = /&[A-Za-z0-9]+;$/;
const NUMERIC_LABEL = /\.\d+$/;
const TRAILING_DOTS = /\.+$/;
const INVALID_EMAIL_END = /[-_]$/;
const URL_PRECEDER = /[\s*_~(]/;
const URL_TRAILING = /[?!.,:*_~'"]+$/;
const URL_SCHEME = /^(?:(?:https?|ftp):\/\/)?(?:www\.)?/;
const FOOTNOTE_REF = /\[\^([^\]\s]+)\]/y;
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "{": "&#123;",
  "}": "&#125;",
};

/** Escape text for Svelte markup: HTML specials plus `{` and `}`. */
export function escapeText(text: string): string {
  return text.replace(ESCAPE_TEXT, (c) => ESCAPES[c]);
}

/** Collapse whitespace and case-fold, so `[Foo  Bar]` finds `[foo bar]: …`. */
export function normalizeLabel(label: string): string {
  return label.trim().replace(WHITESPACE_RUN, " ").toLowerCase().toUpperCase();
}

function decodeNumericEntities(text: string): string {
  return text.replace(NUMERIC_ENTITY, (whole, hex: string, digits: string) => {
    const code = Number.parseInt(digits, hex ? 16 : 10);
    return Number.isNaN(code) || code > 0x10ffff
      ? whole
      : String.fromCodePoint(code || 0xfffd);
  });
}

/** Remove backslash escapes and decode numeric entities in a URL or title. */
export function unescapeString(text: string): string {
  return decodeNumericEntities(text.replace(BACKSLASH_ESCAPE, "$1"));
}

export function normalizeUrl(url: string): string {
  return url.replace(UNSAFE_URL_CHAR, (c) =>
    c === "%" ? "%25" : encodeURIComponent(c),
  );
}

function isWhitespace(c: string | undefined): boolean {
  return c === undefined || UNICODE_WHITESPACE.test(c);
}

function isPunctuation(c: string | undefined): boolean {
  return c !== undefined && UNICODE_PUNCTUATION.test(c);
}

/** Code point before `index`, so astral punctuation counts as one character. */
function charBefore(src: string, index: number): string | undefined {
  if (index <= 0) return undefined;
  const low = src.charCodeAt(index - 1);
  return low >= 0xdc00 && low <= 0xdfff && index >= 2
    ? src.slice(index - 2, index)
    : src[index - 1];
}

function charAt(src: string, index: number): string | undefined {
  return index < src.length
    ? String.fromCodePoint(src.codePointAt(index) ?? 0)
    : undefined;
}

interface LinkTail {
  href: string;
  title: string;
  end: number;
}

function skipSpaces(src: string, i: number): number {
  let newlines = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      if (++newlines > 1) break;
    } else if (c !== " " && c !== "\t") {
      break;
    }
    i++;
  }
  return i;
}

/** `<dest>` or a bare destination with balanced parentheses. */
export function parseDestination(
  src: string,
  start: number,
): { value: string; end: number } | null {
  if (src[start] === "<") {
    for (let i = start + 1; i < src.length; i++) {
      const c = src[i];
      if (c === "\\") i++;
      else if (c === "\n" || c === "<") return null;
      else if (c === ">") return { value: src.slice(start + 1, i), end: i + 1 };
    }
    return null;
  }
  let depth = 0;
  let i = start;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "\\" && ASCII_PUNCTUATION.test(src[i + 1] ?? "")) {
      i++;
    } else if (c === "(") {
      if (++depth > 32) return null;
    } else if (c === ")") {
      if (depth === 0) break;
      depth--;
    } else if (c <= " ") {
      break;
    }
  }
  if (i === start || depth !== 0) return null;
  return { value: src.slice(start, i), end: i };
}

/** A `"title"`, `'title'`, or `(title)`. */
export function parseTitle(
  src: string,
  start: number,
): { value: string; end: number } | null {
  const open = src[start];
  const close = open === "(" ? ")" : open;
  if (open !== '"' && open !== "'" && open !== "(") return null;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") i++;
    else if (c === close) return { value: src.slice(start + 1, i), end: i + 1 };
    else if (open === "(" && c === "(") return null;
  }
  return null;
}

/** `(destination "title")` after a link's closing bracket. */
function parseLinkTail(src: string, start: number): LinkTail | null {
  let i = skipSpaces(src, start + 1);
  let href = "";
  let title = "";
  if (src[i] !== ")") {
    const dest = parseDestination(src, i);
    if (!dest) return null;
    href = dest.value;
    i = dest.end;
    const beforeTitle = i;
    i = skipSpaces(src, i);
    if (i > beforeTitle) {
      const parsed = parseTitle(src, i);
      if (parsed) {
        title = parsed.value;
        i = skipSpaces(src, parsed.end);
      }
    }
  }
  if (src[i] !== ")") return null;
  return { href, title, end: i + 1 };
}

/** The `[label]` at `start`, or null if it isn't one. */
function parseLabel(
  src: string,
  start: number,
): { label: string; end: number } | null {
  LINK_LABEL.lastIndex = start;
  const match = LINK_LABEL.exec(src);
  return match ? { label: match[1], end: LINK_LABEL.lastIndex } : null;
}

function flanking(src: string, start: number, end: number, char: string) {
  const before = charBefore(src, start);
  const after = charAt(src, end);
  const left =
    !isWhitespace(after) &&
    (!isPunctuation(after) || isWhitespace(before) || isPunctuation(before));
  const right =
    !isWhitespace(before) &&
    (!isPunctuation(before) || isWhitespace(after) || isPunctuation(after));
  if (char === "_") {
    return {
      canOpen: left && (!right || isPunctuation(before)),
      canClose: right && (!left || isPunctuation(after)),
    };
  }
  return { canOpen: left, canClose: right };
}

/** Match emphasis delimiters in place (CommonMark's "process emphasis"). */
function processEmphasis(items: Inline[]): void {
  let ci = 0;
  while (ci < items.length) {
    const closer = items[ci];
    if (closer.type !== "delim" || !closer.canClose) {
      ci++;
      continue;
    }
    let found = -1;
    for (let oi = ci - 1; oi >= 0; oi--) {
      const opener = items[oi];
      if (
        opener.type !== "delim" ||
        opener.char !== closer.char ||
        !opener.canOpen
      ) {
        continue;
      }
      if (closer.char === "~") {
        if (opener.count === closer.count) found = oi;
        if (found >= 0) break;
        continue;
      }
      if (
        (opener.canClose || closer.canOpen) &&
        (opener.length + closer.length) % 3 === 0 &&
        !(opener.length % 3 === 0 && closer.length % 3 === 0)
      ) {
        continue;
      }
      found = oi;
      break;
    }
    if (found < 0) {
      if (!closer.canOpen) closer.canClose = false;
      ci++;
      continue;
    }
    const opener = items[found] as Extract<Inline, { type: "delim" }>;
    const use =
      closer.char === "~"
        ? closer.count
        : closer.count >= 2 && opener.count >= 2
          ? 2
          : 1;
    const children = items.splice(found + 1, ci - found - 1);
    items.splice(found + 1, 0, {
      type: closer.char === "~" ? "del" : use === 2 ? "strong" : "em",
      children,
    });
    ci = found + 2;
    opener.count -= use;
    closer.count -= use;
    if (opener.count === 0) {
      items.splice(found, 1);
      ci--;
    }
    if (closer.count === 0) items.splice(ci, 1);
  }
}

/**
 * GFM autolink literals: where each bare URL starts and ends. A URL must
 * follow the start, whitespace, or `*_~(`, and drops trailing punctuation
 * and unbalanced closing parentheses.
 */
function urlLiterals(
  src: string,
): { start: number; end: number; href: string }[] {
  const found: { start: number; end: number; href: string }[] = [];
  for (const match of src.matchAll(URL_LITERAL)) {
    const start = match.index ?? 0;
    if (start > 0 && !URL_PRECEDER.test(src[start - 1])) continue;
    let url = match[0];
    for (let previous = ""; previous !== url; ) {
      previous = url;
      url = url.replace(URL_TRAILING, "").replace(TRAILING_ENTITY, "");
      if (url.endsWith(")") && url.split("(").length < url.split(")").length) {
        url = url.slice(0, -1);
      }
    }
    const host = url.replace(URL_SCHEME, "");
    if (!host.includes(".")) continue;
    found.push({
      start,
      end: start + url.length,
      href: url.startsWith("www.") ? `http://${url}` : url,
    });
  }
  // Emails, except a domain ending in a number (`pkg@1.2.3` is a version).
  for (const match of src.matchAll(EMAIL_LITERAL)) {
    const start = match.index ?? 0;
    if (start > 0 && !URL_PRECEDER.test(src[start - 1])) continue;
    const email = match[0].replace(TRAILING_DOTS, "");
    if (INVALID_EMAIL_END.test(email) || NUMERIC_LABEL.test(email)) continue;
    if (
      found.some((url) => start < url.end && url.start < start + email.length)
    ) {
      continue;
    }
    found.push({ start, end: start + email.length, href: `mailto:${email}` });
  }
  return found.sort((a, b) => a.start - b.start);
}

/** Parse a paragraph's (or heading's, or table cell's) inline content. */
export function parseInline(src: string, options: InlineOptions): Inline[] {
  const items: Inline[] = [];
  const brackets: Bracket[] = [];
  let text = "";
  let pos = 0;
  const urls = options.autolinks ? urlLiterals(src) : [];
  let nextUrl = 0;

  const flush = () => {
    if (text) {
      items.push({ type: "text", value: text });
      text = "";
    }
  };
  const push = (node: Inline) => {
    flush();
    items.push(node);
  };

  while (pos < src.length) {
    SPECIAL.lastIndex = pos;
    const next = SPECIAL.exec(src);
    // A bare URL before the next special character becomes a link. URLs
    // inside code spans, tags, and link destinations were skipped past.
    while (nextUrl < urls.length && urls[nextUrl].start < pos) nextUrl++;
    const url = urls[nextUrl];
    if (url && (!next || url.start < next.index)) {
      text += src.slice(pos, url.start);
      const value = src.slice(url.start, url.end);
      push({
        type: "link",
        href: normalizeUrl(url.href),
        title: "",
        children: [{ type: "text", value }],
      });
      pos = url.end;
      nextUrl++;
      continue;
    }
    if (!next) {
      text += src.slice(pos);
      break;
    }
    text += src.slice(pos, next.index);
    pos = next.index;
    const c = src[pos];

    switch (c) {
      case "\\": {
        const after = src[pos + 1];
        if (after === "\n") {
          text = text.replace(TRAILING_SPACES, "");
          push({ type: "break" });
          pos += 2;
          while (src[pos] === " ") pos++;
        } else if (after !== undefined && ASCII_PUNCTUATION.test(after)) {
          text += after;
          pos += 2;
        } else {
          text += c;
          pos++;
        }
        break;
      }
      case "`": {
        let end = pos;
        while (src[end] === "`") end++;
        const fence = src.slice(pos, end);
        let close = -1;
        let search = src.indexOf(fence, end);
        while (search >= 0) {
          let runEnd = search + fence.length;
          if (src[runEnd] !== "`" && src[search - 1] !== "`") {
            close = search;
            break;
          }
          while (src[runEnd] === "`") runEnd++;
          search = src.indexOf(fence, runEnd);
        }
        if (close < 0) {
          text += fence;
          pos = end;
          break;
        }
        let code = src.slice(end, close).replace(/\n/g, " ");
        if (code[0] === " " && code.endsWith(" ") && code.trim() !== "") {
          code = code.slice(1, -1);
        }
        push({ type: "code", value: code });
        pos = close + fence.length;
        break;
      }
      case "*":
      case "_":
      case "~": {
        let end = pos;
        while (src[end] === c) end++;
        const length = end - pos;
        if (c === "~" && length > 2) {
          text += src.slice(pos, end);
          pos = end;
          break;
        }
        const { canOpen, canClose } = flanking(src, pos, end, c);
        push({
          type: "delim",
          char: c,
          count: length,
          length,
          canOpen,
          canClose,
        });
        pos = end;
        break;
      }
      case "!":
        if (src[pos + 1] === "[") {
          push({ type: "text", value: "![" });
          brackets.push({
            index: items.length - 1,
            start: pos + 2,
            image: true,
            active: true,
          });
          pos += 2;
        } else {
          text += c;
          pos++;
        }
        break;
      case "[": {
        FOOTNOTE_REF.lastIndex = pos;
        const ref = src[pos + 1] === "^" ? FOOTNOTE_REF.exec(src) : null;
        const markup = ref ? options.footnote?.(ref[1]) : undefined;
        if (ref && markup !== undefined) {
          push({ type: "raw", value: markup });
          pos = FOOTNOTE_REF.lastIndex;
          break;
        }
        push({ type: "text", value: "[" });
        brackets.push({
          index: items.length - 1,
          start: pos + 1,
          image: false,
          active: true,
        });
        pos++;
        break;
      }
      case "]": {
        const opener = brackets.pop();
        if (!opener?.active) {
          text += c;
          pos++;
          break;
        }
        let target: LinkTail | null = null;
        if (src[pos + 1] === "(") {
          const tail = parseLinkTail(src, pos + 1);
          if (tail) {
            target = {
              href: normalizeUrl(unescapeString(tail.href)),
              title: unescapeString(tail.title),
              end: tail.end,
            };
          }
        }
        if (!target) {
          let label = src.slice(opener.start, pos);
          let end = pos + 1;
          const full = parseLabel(src, pos + 1);
          if (full && full.label.trim() !== "") {
            label = full.label;
            end = full.end;
          } else if (full) {
            end = full.end;
          }
          const ref =
            label.length <= 999 && options.refs.get(normalizeLabel(label));
          if (ref) target = { ...ref, end };
        }
        if (!target) {
          text += c;
          pos++;
          break;
        }
        flush();
        const children = items.splice(opener.index + 1);
        items.pop();
        processEmphasis(children);
        items.push({
          type: opener.image ? "image" : "link",
          href: target.href,
          title: target.title,
          children,
        });
        if (!opener.image) {
          for (const bracket of brackets) {
            if (!bracket.image) bracket.active = false;
          }
        }
        pos = target.end;
        break;
      }
      case "<": {
        AUTOLINK_URI.lastIndex = pos;
        let match = AUTOLINK_URI.exec(src);
        if (match) {
          push({
            type: "link",
            href: normalizeUrl(match[1]),
            title: "",
            children: [{ type: "text", value: match[1] }],
          });
          pos = AUTOLINK_URI.lastIndex;
          break;
        }
        AUTOLINK_EMAIL.lastIndex = pos;
        match = AUTOLINK_EMAIL.exec(src);
        if (match) {
          push({
            type: "link",
            href: `mailto:${normalizeUrl(match[1])}`,
            title: "",
            children: [{ type: "text", value: match[1] }],
          });
          pos = AUTOLINK_EMAIL.lastIndex;
          break;
        }
        if (src.startsWith("<!--", pos)) {
          const end = src.indexOf("-->", pos + 4);
          if (end >= 0) {
            push({ type: "raw", value: src.slice(pos, end + 3) });
            pos = end + 3;
            break;
          }
        }
        CLOSING_TAG.lastIndex = pos;
        match = CLOSING_TAG.exec(src);
        if (match) {
          push({ type: "raw", value: match[0] });
          pos = CLOSING_TAG.lastIndex;
          break;
        }
        const tag = scanTag(src, pos);
        if (tag && !tag.closing) {
          push({ type: "raw", value: src.slice(pos, tag.end) });
          pos = tag.end;
          break;
        }
        text += c;
        pos++;
        break;
      }
      case "&": {
        ENTITY.lastIndex = pos;
        const match = ENTITY.exec(src);
        if (match) {
          push({ type: "raw", value: match[0] });
          pos = ENTITY.lastIndex;
        } else {
          text += c;
          pos++;
        }
        break;
      }
      case "{": {
        const end = options.expressions ? skipExpression(src, pos) : -1;
        if (end > 0) {
          push({ type: "raw", value: src.slice(pos, end) });
          pos = end;
        } else {
          text += c;
          pos++;
        }
        break;
      }
      case "\n": {
        const hard = text.endsWith("  ");
        text = text.replace(TRAILING_SPACES, "");
        if (hard) push({ type: "break" });
        else text += "\n";
        pos++;
        while (src[pos] === " ") pos++;
        break;
      }
      default:
        text += c;
        pos++;
    }
  }
  flush();
  processEmphasis(items);
  return items;
}

/**
 * `"html"` renders markup; `"text"` renders escaped text content only (for
 * `alt`); `"raw"` renders unescaped text content (for heading ids).
 */
type RenderMode = "html" | "text" | "raw";

function renderNodes(
  nodes: Inline[],
  mode: RenderMode,
  image?: InlineOptions["image"],
): string {
  const html = mode === "html";
  const esc = mode === "raw" ? (s: string) => s : escapeText;
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out += esc(node.value);
        break;
      case "raw":
        if (html) out += node.value;
        break;
      case "code":
        out += html
          ? `<code>${escapeText(node.value)}</code>`
          : esc(node.value);
        break;
      case "break":
        out += html ? "<br />\n" : "\n";
        break;
      case "delim":
        out += esc(node.char.repeat(node.count));
        break;
      case "em":
      case "strong":
      case "del": {
        const inner = renderNodes(node.children, mode, image);
        out += html ? `<${node.type}>${inner}</${node.type}>` : inner;
        break;
      }
      case "link": {
        const inner = renderNodes(node.children, mode, image);
        const title = node.title ? ` title="${escapeText(node.title)}"` : "";
        out += html
          ? `<a href="${escapeText(node.href)}"${title}>${inner}</a>`
          : inner;
        break;
      }
      case "image": {
        const alt = renderNodes(node.children, html ? "text" : mode);
        const title = node.title ? ` title="${escapeText(node.title)}"` : "";
        out += html
          ? `<img src="${escapeText(node.href)}" alt="${alt}"${title}${image?.(node.href) ?? ""} />`
          : alt;
        break;
      }
    }
  }
  return out;
}

/** Render inline Markdown to Svelte markup. */
export function renderInline(src: string, options: InlineOptions): string {
  return renderNodes(parseInline(src, options), "html", options.image);
}

/**
 * Unescaped text content of inline Markdown: tags dropped, code spans kept
 * as their text. Used for heading ids and the `headings` export.
 */
export function inlineText(src: string, options: InlineOptions): string {
  return renderNodes(parseInline(src, options), "raw").trim();
}
