/**
 * Svelte-aware scanning: find where an expression, tag, or element ends
 * without parsing it. The Markdown parser uses these to pass Svelte markup
 * through verbatim, so a component block runs to its closing tag (blank lines
 * included) instead of ending at the first blank line like a CommonMark HTML
 * block.
 */

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** Elements whose content is text, not markup. */
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea"]);

const TAG_NAME = /[A-Za-z][\w.-]*(?::[A-Za-z][\w.-]*)?/y;
const AFTER_TAG_NAME = /[\s/>]/;

export interface ScannedTag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  /** Index just past the closing `>`. */
  end: number;
}

/** Index of the quote that closes the string opening at `start`, or -1. */
function skipString(src: string, start: number): number {
  const quote = src[start];
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      i++;
    } else if (c === quote) {
      return i;
    } else if (quote === "`" && c === "$" && src[i + 1] === "{") {
      const end = skipExpression(src, i + 1);
      if (end < 0) return -1;
      i = end - 1;
    }
  }
  return -1;
}

/** Index just past the `}` matching the `{` at `start`, or -1. */
export function skipExpression(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      if (i < 0) return -1;
    } else if (c === "/" && src[i + 1] === "/") {
      const newline = src.indexOf("\n", i);
      if (newline < 0) return -1;
      i = newline;
    } else if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      if (close < 0) return -1;
      i = close + 1;
    } else if (c === "{") {
      depth++;
    } else if (c === "}" && --depth === 0) {
      return i + 1;
    }
  }
  return -1;
}

/**
 * The open or close tag starting at `start` (a `<`), with Svelte attribute
 * expressions skipped, so `on:click={() => a > b}` doesn't end the tag early.
 */
export function scanTag(src: string, start: number): ScannedTag | null {
  let i = start + 1;
  const closing = src[i] === "/";
  if (closing) i++;
  TAG_NAME.lastIndex = i;
  const match = TAG_NAME.exec(src);
  if (!match) return null;
  const name = match[0];
  i += name.length;
  if (!AFTER_TAG_NAME.test(src[i] ?? "")) return null;

  while (i < src.length) {
    const c = src[i];
    if (c === ">") return { name, closing, selfClosing: false, end: i + 1 };
    if (c === "/" && src[i + 1] === ">") {
      return { name, closing, selfClosing: true, end: i + 2 };
    }
    if (c === "{") {
      i = skipExpression(src, i);
      if (i < 0) return null;
      continue;
    }
    if (c === '"' || c === "'") {
      // Quoted attribute values may hold expressions with the same quote:
      // `on:click="{() => log("x")}"`.
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === "{") {
          j = skipExpression(src, j);
          if (j < 0) return null;
        } else {
          j++;
        }
      }
      i = j + 1;
      continue;
    }
    i++;
  }
  return null;
}

function isVoid(name: string): boolean {
  return VOID_ELEMENTS.has(name);
}

/** Index just past the comment starting at `start`, or -1. */
function skipComment(src: string, start: number): number {
  const end = src.indexOf("-->", start + 4);
  return end < 0 ? -1 : end + 3;
}

/** Index just past `</name ...>` at or after `from`, or -1. */
function skipRawText(src: string, name: string, from: number): number {
  const close = src.indexOf(`</${name}`, from);
  if (close < 0) return -1;
  const end = src.indexOf(">", close);
  return end < 0 ? -1 : end + 1;
}

/**
 * Index just past the element (open tag, children, and matching close tag)
 * or comment starting at `start`, or -1 if it never closes. Close tags that
 * match no open element are ignored.
 */
export function scanElement(src: string, start: number): number {
  if (src.startsWith("<!--", start)) return skipComment(src, start);
  const open = scanTag(src, start);
  if (!open || open.closing) return -1;
  if (open.selfClosing || isVoid(open.name)) return open.end;
  if (RAW_TEXT_ELEMENTS.has(open.name)) {
    return skipRawText(src, open.name, open.end);
  }

  const stack = [open.name];
  let i = open.end;
  while (i < src.length) {
    const c = src[i];
    if (c === "{") {
      const end = skipExpression(src, i);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    if (c !== "<") {
      i++;
      continue;
    }
    if (src.startsWith("<!--", i)) {
      i = skipComment(src, i);
      if (i < 0) return -1;
      continue;
    }
    const tag = scanTag(src, i);
    if (!tag) {
      i++;
      continue;
    }
    i = tag.end;
    if (tag.closing) {
      const at = stack.lastIndexOf(tag.name);
      if (at >= 0) stack.length = at;
      if (stack.length === 0) return i;
    } else if (RAW_TEXT_ELEMENTS.has(tag.name)) {
      i = skipRawText(src, tag.name, i);
      if (i < 0) return -1;
    } else if (!tag.selfClosing && !isVoid(tag.name)) {
      stack.push(tag.name);
    }
  }
  return -1;
}
