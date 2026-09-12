import {
  isFlatpickrKeyframes,
  isUnusedIbmPlexFontFace,
  pruneRuleSelector,
  type StrictCssOptimizerOptions,
} from "./strict-css-optimizer";

/**
 * Optimizes a stylesheet by splicing the source text instead of parsing it
 * into a PostCSS AST and re-serializing. PostCSS is lossless, so for a
 * stylesheet whose shape this module models exactly (the shape every
 * compiled Carbon theme has), removing a node or rewriting a selector is a
 * pure text edit.
 *
 * Fidelity is by construction: the tokenizer and statement parser below
 * mirror `postcss/lib/tokenize` and `postcss/lib/parser` case by case
 * (including their quirks, e.g. the `url(` lookbehind buffer and
 * `RE_BAD_BRACKET`), the visitor pass replays PostCSS's dirty-node re-walk,
 * and the emitter reproduces `postcss/lib/stringifier`'s semicolon rules.
 *
 * A few PostCSS behaviors are deliberately not reproduced, since they are
 * quirks of round-tripping through an AST rather than anything a bundler
 * asset depends on: `<` is never escaped, a byte-order mark and a
 * `sourceMappingURL` comment are left exactly as they appear in the source,
 * and `postcss-discard-empty`'s deletion of empty declarations, empty-
 * selector rules, paramless at-rule statements, and a duplicate/empty
 * named `@layer` is not replicated (only containers left with no
 * surviving children are still dropped). Anything this scanner cannot
 * classify — a genuine syntax error, or a construct too ambiguous to
 * compute an allowlist decision for — returns the input unchanged
 * (`removed: 0`) instead of guessing.
 */

export type SpliceOptimizerOptions = StrictCssOptimizerOptions & {
  preserveAllIBMFonts: boolean;
};

// Char codes
const TAB = 9;
const NEWLINE = 10;
const FEED = 12;
const CR = 13;
const SPACE = 32;
const BANG = 33;
const DOUBLE_QUOTE = 34;
const SINGLE_QUOTE = 39;
const OPEN_PAREN = 40;
const CLOSE_PAREN = 41;
const ASTERISK = 42;
const HYPHEN = 45;
const SLASH = 47;
const COLON = 58;
const SEMICOLON = 59;
const AT = 64;
const OPEN_SQUARE = 91;
const BACKSLASH = 92;
const CLOSE_SQUARE = 93;
const UNDERSCORE = 95;
const OPEN_CURLY = 123;
const CLOSE_CURLY = 125;
const BOM = 0xfeff;
const BOM_REVERSED = 0xfffe;

// Token types
const T_SPACE = 1;
const T_WORD = 2;
const T_STRING = 3;
const T_AT_WORD = 4;
const T_OPEN_PAREN = 5;
const T_CLOSE_PAREN = 6;
const T_BRACKETS = 7;
const T_OPEN_SQUARE = 8;
const T_CLOSE_SQUARE = 9;
const T_OPEN_CURLY = 10;
const T_CLOSE_CURLY = 11;
const T_COLON = 12;
const T_SEMICOLON = 13;
const T_COMMENT = 14;

// Node types
const N_ROOT = 0;
const N_RULE = 1;
const N_AT_BLOCK = 2;
const N_AT_STATEMENT = 3;
const N_COMMENT = 4;

/**
 * `RE_WORD_END`: `1` ends a word outright; `2` (`/`) ends it only when a
 * `*` follows, i.e. the `/(?=*)` alternative that needs a lookahead.
 */
const WORD_END = new Uint8Array(128);
for (const ch of "\t\n\f\r !\"#'():;@[\\]{}") WORD_END[ch.charCodeAt(0)] = 1;
WORD_END[SLASH] = 2;
/** `RE_AT_END`. */
const AT_END = new Uint8Array(128);
for (const ch of "\t\n\f\r \"#'()/;[\\]{}") AT_END[ch.charCodeAt(0)] = 1;
/** Character class of `RE_BAD_BRACKET`. */
const BAD_BRACKET = new Uint8Array(128);
for (const ch of "\r\n\"'(/\\") BAD_BRACKET[ch.charCodeAt(0)] = 1;

/** Thrown to abandon the splice path; never escapes `spliceOptimizeCss`. */
const BAIL = Symbol("bail");

function bail(): never {
  throw BAIL;
}

/**
 * `1` when the source starts with a byte-order mark (correct or reversed),
 * else `0`. PostCSS strips this before tokenizing and always re-emits the
 * correct `﻿`, "fixing" a reversed one; this scanner instead leaves the
 * source's first character exactly as it is and only skips it when
 * tokenizing, so `this.spaces`/`Tokenizer#pos` start one past it.
 */
function bomLength(css: string): number {
  const first = css.charCodeAt(0);
  return first === BOM || first === BOM_REVERSED ? 1 : 0;
}

/**
 * Mirror of `postcss/lib/parser`'s `raw()` comment handling: a comment with a
 * space/boundary neighbor on either side is dropped (as is one that directly
 * follows a bare `,`, an edge that only matters for comma-separated lists
 * such as selectors); everything else, including a comment with no safe
 * neighbor, is kept verbatim. Never used for the common case (no comment in
 * range): callers only invoke this once a comment has already been spotted.
 */
function hasCommentToken(types: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    if (types[i] === T_COMMENT) return true;
  }
  return false;
}

function rawClean(
  css: string,
  types: Uint8Array,
  starts: Int32Array,
  ends: Int32Array,
  from: number,
  to: number,
): string {
  let value = "";
  for (let i = from; i < to; i++) {
    if (types[i] === T_COMMENT) {
      const prevSafe = i === from || types[i - 1] === T_SPACE;
      const nextSafe = i === to - 1 || types[i + 1] === T_SPACE;
      if (prevSafe || nextSafe) continue;
      if (value.endsWith(",")) continue;
    }
    value += css.slice(starts[i], ends[i]);
  }
  return value;
}

/**
 * Mirror of `postcss/lib/parser`'s bareword-`important` detection (a value
 * ending in `important` with no leading `!` glued to it, e.g. `x ! y
 * important`): PostCSS re-walks its own value tokens from the end,
 * treating them as a shrinking buffer it only ever pops from the tail, and
 * accepts the run back to (but never including) the first real token if
 * the accumulated text ends up starting with `!`. Since popping only
 * happens from the tail, the survivors are always exactly the prefix
 * `[from, from + len)` for some `len`, so this tracks `len` instead of a
 * real buffer. `[from, to)` is the value's real (non-trivia) token range;
 * `important` is the index of the trailing `important` word within it.
 * Returns the new exclusive end when it triggers, else `null` (leaves the
 * value as plain text, exactly like PostCSS's decl() does when the `!`
 * never gets consumed into the run).
 */
function findBarewordImportantEnd(
  css: string,
  types: Uint8Array,
  starts: Int32Array,
  ends: Int32Array,
  from: number,
  to: number,
  important: number,
): number | null {
  let len = to - from;
  let str = "";
  for (let j = important - from; j > 0; j--) {
    const idx = from + len - 1;
    if (str.trim().startsWith("!") && types[idx] !== T_SPACE) break;
    str = css.slice(starts[idx], ends[idx]) + str;
    len--;
  }
  return str.trim().startsWith("!") ? from + len : null;
}

function isWhitespace(code: number): boolean {
  return (
    code === SPACE ||
    code === NEWLINE ||
    code === TAB ||
    code === CR ||
    code === FEED
  );
}

function isHexDigit(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 70) ||
    (code >= 97 && code <= 102)
  );
}

/** `.` in `RE_BAD_BRACKET` does not match line terminators. */
function isLineTerminator(code: number): boolean {
  return code === NEWLINE || code === CR || code === 0x2028 || code === 0x2029;
}

/**
 * A container's children, in source order. Declarations are stored as
 * non-negative indices into the parser's flat `Decls` arrays instead of as
 * `CssNode`s: they outnumber every other node three to one in a compiled
 * Carbon theme, are never removed on their own, and only ever need their
 * offsets read back.
 */
type Child = CssNode | number;

class CssNode {
  type: number;
  parent: CssNode | null;
  nodes: Child[] | null;
  /** Offset where `raws.before` starts. */
  before: number;
  /** Offset of the first token. */
  start: number;
  /**
   * Exclusive end. Containers: after `}`. At-rule statements: before the
   * `;` (if any). Comments: after `*​/`.
   */
  end: number;
  /** At-rule statement ended with `;` in the source. */
  semi: boolean;
  /** Rule: selector range. At-rule: params range. */
  a: number;
  b: number;
  /** At-rule name. */
  name: string;
  /** Rule: rewritten selector, or `null` when untouched. */
  selector: string | null;
  /**
   * The `raw()`-clean text (comments dropped per neighbor-safety, `!important`
   * suffix stripped) when it differs from `css.slice(a, b)`; `null` when the
   * raw slice already equals it. Rule: clean selector, used by
   * `pruneRuleSelector` in place of the raw slice. At-rule: clean params,
   * used for `isFlatpickrKeyframes` and a named `@layer`'s emptiness check.
   * (Declarations have the same idea in `Decls#clean`, since they are not
   * `CssNode`s.) Never used for output: nodes are only ever kept verbatim
   * or removed wholesale, never individually rewritten from this text
   * (rules are the one exception, via `selector`).
   */
  clean: string | null;
  /** Container `raws.semicolon`. */
  semicolon: boolean;
  /** Container is (or is nested in) a `@font-face` block. */
  fontFace: boolean;
  removed: boolean;
  dirty: boolean;

  constructor(type: number, parent: CssNode | null, before: number) {
    this.type = type;
    this.parent = parent;
    this.nodes =
      type === N_ROOT || type === N_RULE || type === N_AT_BLOCK ? [] : null;
    this.before = before;
    this.start = before;
    this.end = before;
    this.semi = false;
    this.a = 0;
    this.b = 0;
    this.name = "";
    this.selector = null;
    this.clean = null;
    this.semicolon = false;
    this.fontFace = parent?.fontFace === true;
    this.removed = false;
    this.dirty = false;
  }
}

const D_SEMI = 1;
const D_CUSTOM = 2;

/**
 * Struct-of-arrays store for declarations. Per declaration: property
 * `[start, propEnd)`, value `[a, b)`, exclusive `end` (before the `;` if
 * any), and `D_SEMI` / `D_CUSTOM` flags. No `raws.before`: a declaration is
 * never removed on its own, so its leading whitespace is never spliced.
 * `clean` holds the `raw()`-clean value (comments dropped, `!important`
 * suffix stripped) for the rare declaration where it differs from
 * `css.slice(a, b)` — only `@font-face` descriptor comparison ever reads
 * it, so a sparse map beats a slot per declaration.
 */
class Decls {
  start: Int32Array;
  propEnd: Int32Array;
  a: Int32Array;
  b: Int32Array;
  end: Int32Array;
  flags: Uint8Array;
  clean: Map<number, string>;
  count: number;

  constructor(capacity: number) {
    this.start = new Int32Array(capacity);
    this.propEnd = new Int32Array(capacity);
    this.a = new Int32Array(capacity);
    this.b = new Int32Array(capacity);
    this.end = new Int32Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.clean = new Map();
    this.count = 0;
  }

  push(
    start: number,
    propEnd: number,
    a: number,
    b: number,
    end: number,
    flags: number,
  ): number {
    const i = this.count;
    if (i === this.start.length) this.grow();
    this.start[i] = start;
    this.propEnd[i] = propEnd;
    this.a[i] = a;
    this.b[i] = b;
    this.end[i] = end;
    this.flags[i] = flags;
    this.count = i + 1;
    return i;
  }

  private grow(): void {
    const size = this.start.length * 2;
    this.start = growInt32(this.start, size);
    this.propEnd = growInt32(this.propEnd, size);
    this.a = growInt32(this.a, size);
    this.b = growInt32(this.b, size);
    this.end = growInt32(this.end, size);
    const flags = new Uint8Array(size);
    flags.set(this.flags);
    this.flags = flags;
  }
}

function growInt32(array: Int32Array, size: number): Int32Array {
  const next = new Int32Array(size);
  next.set(array);
  return next;
}

/**
 * Mirror of `postcss/lib/tokenize`, minus token allocation: each call to
 * `next()` leaves the token in `type` / `start` / `end` (exclusive).
 */
class Tokenizer {
  css: string;
  length: number;
  pos: number;
  type: number;
  start: number;
  end: number;
  /**
   * PostCSS keeps a stack of every word token and pops it at each `(` to
   * decide whether the paren is a `url(` opener. Only "was that word `url`"
   * matters, so the stack is stored as run lengths of non-`url` words:
   * `leading` before the first `url`, then one count per `url` pushed.
   */
  leading: number;
  runs: number[];
  lastBadParen: number;

  constructor(css: string) {
    this.css = css;
    this.length = css.length;
    this.pos = bomLength(css);
    this.type = 0;
    this.start = 0;
    this.end = 0;
    this.leading = 0;
    this.runs = [];
    this.lastBadParen = -1;
  }

  private pushWord(start: number, end: number): void {
    const css = this.css;
    if (
      end - start === 3 &&
      css.charCodeAt(start) === 117 &&
      css.charCodeAt(start + 1) === 114 &&
      css.charCodeAt(start + 2) === 108
    ) {
      this.runs.push(0);
    } else if (this.runs.length > 0) {
      this.runs[this.runs.length - 1]++;
    } else {
      this.leading++;
    }
  }

  /** `buffer.pop()[1] === 'url'`. */
  private popWordIsUrl(): boolean {
    const runs = this.runs;
    if (runs.length > 0) {
      const top = runs.length - 1;
      if (runs[top] > 0) {
        runs[top]--;
        return false;
      }
      runs.pop();
      return true;
    }
    if (this.leading > 0) this.leading--;
    return false;
  }

  next(): boolean {
    const css = this.css;
    const length = this.length;
    const pos = this.pos;
    if (pos >= length) return false;

    const code = css.charCodeAt(pos);
    let next: number;
    this.start = pos;

    switch (code) {
      case NEWLINE:
      case SPACE:
      case TAB:
      case CR:
      case FEED: {
        next = pos;
        do {
          next += 1;
        } while (isWhitespace(css.charCodeAt(next)));
        this.type = T_SPACE;
        this.end = next;
        break;
      }

      case OPEN_SQUARE:
        this.type = T_OPEN_SQUARE;
        this.end = pos + 1;
        break;
      case CLOSE_SQUARE:
        this.type = T_CLOSE_SQUARE;
        this.end = pos + 1;
        break;
      case OPEN_CURLY:
        this.type = T_OPEN_CURLY;
        this.end = pos + 1;
        break;
      case CLOSE_CURLY:
        this.type = T_CLOSE_CURLY;
        this.end = pos + 1;
        break;
      case COLON:
        this.type = T_COLON;
        this.end = pos + 1;
        break;
      case SEMICOLON:
        this.type = T_SEMICOLON;
        this.end = pos + 1;
        break;
      case CLOSE_PAREN:
        this.type = T_CLOSE_PAREN;
        this.end = pos + 1;
        break;

      case OPEN_PAREN: {
        const prevIsUrl = this.popWordIsUrl();
        const n = css.charCodeAt(pos + 1);
        if (
          prevIsUrl &&
          n !== SINGLE_QUOTE &&
          n !== DOUBLE_QUOTE &&
          !isWhitespace(n)
        ) {
          next = pos;
          let escaped: boolean;
          do {
            escaped = false;
            next = css.indexOf(")", next + 1);
            if (next === -1) bail();
            let escapePos = next;
            while (css.charCodeAt(escapePos - 1) === BACKSLASH) {
              escapePos -= 1;
              escaped = !escaped;
            }
          } while (escaped);
          this.type = T_BRACKETS;
          this.end = next + 1;
        } else if (pos <= this.lastBadParen) {
          this.type = T_OPEN_PAREN;
          this.end = pos + 1;
        } else {
          next = css.indexOf(")", pos + 1);
          if (next === -1 || this.hasBadBracketChar(pos + 1, next + 1)) {
            this.lastBadParen = next === -1 ? length : next;
            this.type = T_OPEN_PAREN;
            this.end = pos + 1;
          } else {
            this.type = T_BRACKETS;
            this.end = next + 1;
          }
        }
        break;
      }

      case SINGLE_QUOTE:
      case DOUBLE_QUOTE: {
        const quote = code === SINGLE_QUOTE ? "'" : '"';
        next = pos;
        let escaped: boolean;
        do {
          escaped = false;
          next = css.indexOf(quote, next + 1);
          if (next === -1) bail();
          let escapePos = next;
          while (css.charCodeAt(escapePos - 1) === BACKSLASH) {
            escapePos -= 1;
            escaped = !escaped;
          }
        } while (escaped);
        this.type = T_STRING;
        this.end = next + 1;
        break;
      }

      case AT: {
        next = pos + 1;
        while (next < length) {
          const c = css.charCodeAt(next);
          if (c < 128 && AT_END[c] === 1) break;
          next += 1;
        }
        this.type = T_AT_WORD;
        this.end = next;
        break;
      }

      case BACKSLASH: {
        next = pos;
        let escaping = true;
        while (css.charCodeAt(next + 1) === BACKSLASH) {
          next += 1;
          escaping = !escaping;
        }
        const c = css.charCodeAt(next + 1);
        if (escaping && c !== SLASH && !isWhitespace(c)) {
          next += 1;
          if (isHexDigit(css.charCodeAt(next))) {
            while (isHexDigit(css.charCodeAt(next + 1))) {
              next += 1;
            }
            if (css.charCodeAt(next + 1) === SPACE) {
              next += 1;
            }
          }
        }
        // A `word` token that PostCSS does not push onto its lookbehind buffer.
        this.type = T_WORD;
        this.end = next + 1;
        break;
      }

      default: {
        if (code === SLASH && css.charCodeAt(pos + 1) === ASTERISK) {
          next = css.indexOf("*/", pos + 2);
          if (next === -1) bail();
          this.type = T_COMMENT;
          this.end = next + 2;
        } else {
          next = pos + 1;
          while (next < length) {
            const c = css.charCodeAt(next);
            if (c < 128) {
              const kind = WORD_END[c];
              if (kind === 1) break;
              if (kind === 2 && css.charCodeAt(next + 1) === ASTERISK) break;
            }
            next += 1;
          }
          this.type = T_WORD;
          this.end = next;
          this.pushWord(pos, next);
        }
        break;
      }
    }

    this.pos = this.end;
    return true;
  }

  /** `RE_BAD_BRACKET.test(css.slice(from - 1, to))`. */
  private hasBadBracketChar(from: number, to: number): boolean {
    const css = this.css;
    for (let i = from; i < to; i++) {
      const c = css.charCodeAt(i);
      if (c < 128 && BAD_BRACKET[c] === 1) {
        if (!isLineTerminator(css.charCodeAt(i - 1))) return true;
      }
    }
    return false;
  }
}

/**
 * Mirror of the structural half of `postcss/lib/parser`. Produces a tree of
 * `CssNode`s holding source offsets; bails on any input whose PostCSS
 * serialization would not be a splice of the source.
 */
class Parser {
  css: string;
  tokenizer: Tokenizer;
  root: CssNode;
  current: CssNode;
  /** Offset where the pending `raws.before` whitespace starts. */
  spaces: number;
  /** Parser `semicolon` flag: last statement ended with `;`. */
  semicolon: boolean;
  /** Token buffer for one statement: type, start, end per token. */
  tokTypes: Uint8Array;
  tokStarts: Int32Array;
  tokEnds: Int32Array;
  tokCount: number;
  decls: Decls;

  constructor(css: string) {
    this.css = css;
    this.tokenizer = new Tokenizer(css);
    this.root = new CssNode(N_ROOT, null, 0);
    this.current = this.root;
    this.spaces = bomLength(css);
    this.semicolon = false;
    this.tokTypes = new Uint8Array(64);
    this.tokStarts = new Int32Array(64);
    this.tokEnds = new Int32Array(64);
    this.tokCount = 0;
    // Compiled Carbon themes run about one declaration per 50 bytes.
    this.decls = new Decls(Math.max(64, (css.length / 48) | 0));
  }

  parse(): CssNode {
    const tokenizer = this.tokenizer;
    while (tokenizer.next()) {
      const type = tokenizer.type;
      if (type === T_SPACE) continue;
      if (type === T_CLOSE_CURLY) {
        this.end(tokenizer.end);
      } else if (type === T_COMMENT) {
        this.comment();
      } else if (type === T_AT_WORD) {
        this.atrule();
      } else if (type === T_SEMICOLON) {
        this.freeSemicolon(tokenizer.end);
      } else if (type === T_OPEN_CURLY) {
        this.emptyRule();
      } else {
        this.other();
      }
    }
    this.endFile();
    return this.root;
  }

  private init(node: CssNode): void {
    this.current.nodes?.push(node);
    node.before = this.spaces;
    if (node.type !== N_COMMENT) this.semicolon = false;
  }

  private pushToken(): void {
    const i = this.tokCount;
    if (i === this.tokTypes.length) {
      const size = i * 2;
      const types = new Uint8Array(size);
      const starts = new Int32Array(size);
      const ends = new Int32Array(size);
      types.set(this.tokTypes);
      starts.set(this.tokStarts);
      ends.set(this.tokEnds);
      this.tokTypes = types;
      this.tokStarts = starts;
      this.tokEnds = ends;
    }
    const t = this.tokenizer;
    this.tokTypes[i] = t.type;
    this.tokStarts[i] = t.start;
    this.tokEnds[i] = t.end;
    this.tokCount = i + 1;
  }

  private comment(): void {
    const t = this.tokenizer;
    const node = new CssNode(N_COMMENT, this.current, this.spaces);
    this.init(node);
    node.start = t.start;
    node.end = t.end;
    this.spaces = t.end;
  }

  private atrule(): void {
    const t = this.tokenizer;
    const css = this.css;
    const name = css.slice(t.start + 1, t.end);
    if (name === "") bail();
    const nameEnd = t.end;

    const node = new CssNode(N_AT_BLOCK, this.current, this.spaces);
    this.init(node);
    node.start = t.start;
    node.name = name;
    if (name === "font-face") node.fontFace = true;

    const brackets: number[] = [];
    let open = false;
    let semi = false;
    let closedByParent = false;
    this.tokCount = 0;

    while (t.next()) {
      const type = t.type;
      if (type === T_OPEN_PAREN || type === T_OPEN_SQUARE) {
        brackets.push(type === T_OPEN_PAREN ? T_CLOSE_PAREN : T_CLOSE_SQUARE);
      } else if (type === T_OPEN_CURLY && brackets.length > 0) {
        brackets.push(T_CLOSE_CURLY);
      } else if (type === brackets[brackets.length - 1]) {
        brackets.pop();
      }

      if (brackets.length === 0) {
        if (type === T_SEMICOLON) {
          semi = true;
          break;
        }
        if (type === T_OPEN_CURLY) {
          open = true;
          break;
        }
        if (type === T_CLOSE_CURLY) {
          closedByParent = true;
          break;
        }
      }

      // Params token. Leading and trailing space/comment tokens become
      // `afterName` / `between`, verbatim (never touched by the emitter);
      // a comment between two params tokens is stripped from `node.clean`
      // via the same `raw()` neighbor rule as a selector's.
      this.pushToken();
    }

    const types = this.tokTypes;
    const starts = this.tokStarts;
    const ends = this.tokEnds;
    let paramsFrom = 0;
    let paramsTo = this.tokCount;
    while (paramsFrom < paramsTo) {
      const type = types[paramsFrom];
      if (type !== T_SPACE && type !== T_COMMENT) break;
      paramsFrom++;
    }
    while (paramsTo > paramsFrom) {
      const type = types[paramsTo - 1];
      if (type !== T_SPACE && type !== T_COMMENT) break;
      paramsTo--;
    }

    const hasParams = paramsTo > paramsFrom;
    if (hasParams) {
      node.a = starts[paramsFrom];
      node.b = ends[paramsTo - 1];
      node.clean = hasCommentToken(types, paramsFrom, paramsTo)
        ? rawClean(css, types, starts, ends, paramsFrom, paramsTo)
        : null;
    }

    if (open) {
      this.current = node;
      this.spaces = t.end;
      return;
    }

    node.type = N_AT_STATEMENT;
    node.nodes = null;

    if (semi) {
      node.semi = true;
      node.end = t.start;
      this.semicolon = true;
      this.spaces = t.end;
    } else if (closedByParent) {
      node.end = t.start;
      this.spaces = t.start;
      this.end(t.end);
    } else {
      // EOF: trailing whitespace moves to `root.raws.after`. `@foo;` with
      // no params is kept (unlike `postcss-discard-empty`), so `node.b` is
      // only meaningful when params were actually found.
      node.end = hasParams ? node.b : nameEnd;
      this.spaces = node.end;
    }
  }

  private other(): void {
    const t = this.tokenizer;
    const css = this.css;
    this.tokCount = 0;

    const customProperty =
      t.type === T_WORD &&
      css.charCodeAt(t.start) === HYPHEN &&
      css.charCodeAt(t.start + 1) === HYPHEN;

    const brackets: number[] = [];
    let colon = false;
    let end = false;
    let more = true;

    for (;;) {
      const type = t.type;
      this.pushToken();

      if (type === T_OPEN_PAREN || type === T_OPEN_SQUARE) {
        brackets.push(type === T_OPEN_PAREN ? T_CLOSE_PAREN : T_CLOSE_SQUARE);
      } else if (customProperty && colon && type === T_OPEN_CURLY) {
        brackets.push(T_CLOSE_CURLY);
      } else if (brackets.length === 0) {
        if (type === T_SEMICOLON) {
          if (colon) {
            this.decl(customProperty);
            return;
          }
          // Unknown word.
          bail();
        } else if (type === T_OPEN_CURLY) {
          this.rule();
          return;
        } else if (type === T_CLOSE_CURLY) {
          // Push the `}` back and let `parse()` close the block.
          t.pos = t.start;
          this.tokCount--;
          end = true;
          break;
        } else if (type === T_COLON) {
          colon = true;
        }
      } else if (type === brackets[brackets.length - 1]) {
        brackets.pop();
      }

      more = t.next();
      if (!more) break;
    }

    if (!more) end = true;
    if (brackets.length > 0) bail();

    if (end && colon) {
      if (!customProperty) {
        // Trailing space/comment tokens become statement-level.
        while (this.tokCount > 0) {
          const last = this.tokTypes[this.tokCount - 1];
          if (last !== T_SPACE && last !== T_COMMENT) break;
          this.tokCount--;
          t.pos = this.tokStarts[this.tokCount];
        }
      }
      this.decl(customProperty);
    } else {
      bail();
    }
  }

  /**
   * A bare `{`: a rule with an empty selector. PostCSS keeps these (they are
   * only dropped by `postcss-discard-empty`'s own empty-selector rule, which
   * this scanner does not replicate).
   */
  private emptyRule(): void {
    const t = this.tokenizer;
    const node = new CssNode(N_RULE, this.current, this.spaces);
    this.init(node);
    node.start = t.start;
    node.a = t.start;
    node.b = t.start;
    this.current = node;
    this.spaces = t.end;
  }

  private rule(): void {
    const types = this.tokTypes;
    const starts = this.tokStarts;
    const ends = this.tokEnds;
    // Drop the `{`.
    let count = this.tokCount - 1;
    const bodyStart = ends[count];
    while (count > 0) {
      const last = types[count - 1];
      if (last !== T_SPACE && last !== T_COMMENT) break;
      count--;
    }
    const node = new CssNode(N_RULE, this.current, this.spaces);
    this.init(node);
    node.start = starts[0];
    node.a = node.start;
    node.b = ends[count - 1];
    node.clean = hasCommentToken(types, 0, count)
      ? rawClean(this.css, types, starts, ends, 0, count)
      : null;
    this.current = node;
    this.spaces = bodyStart;
  }

  private decl(customProperty: boolean): void {
    const types = this.tokTypes;
    const starts = this.tokStarts;
    const ends = this.tokEnds;
    const css = this.css;
    let count = this.tokCount;

    let semi = false;
    let semiEnd = 0;
    if (types[count - 1] === T_SEMICOLON) {
      semi = true;
      semiEnd = ends[count - 1];
      count--;
    }

    // PostCSS moves a leading `*`/`_` hack char into `raws.before`; the rest
    // of the property must be a word.
    if (types[0] !== T_WORD) bail();
    let propStart = starts[0];
    const first = css.charCodeAt(propStart);
    if (first === UNDERSCORE || first === ASTERISK) propStart++;

    // Only whitespace or a comment may separate the property from its
    // colon; anything else lands in `raws.between` or throws.
    let i = 1;
    let sawColon = false;
    for (; i < count; i++) {
      const type = types[i];
      if (type === T_COLON) {
        sawColon = true;
        i++;
        break;
      }
      if (type !== T_SPACE && type !== T_COMMENT) bail();
    }
    if (!sawColon) bail();

    const valueStart = i;
    let valueFrom = -1;
    let valueTo = -1;
    let firstRealIndex = -1;
    let hasBang = false;
    let hasComment = false;
    let parens = 0;
    for (let j = valueStart; j < count; j++) {
      const type = types[j];
      if (type === T_SPACE) continue;
      if (type === T_COMMENT) {
        hasComment = true;
        continue;
      }
      if (valueFrom === -1) {
        valueFrom = starts[j];
        firstRealIndex = j;
      }
      valueTo = ends[j];
      if (type === T_OPEN_PAREN) parens++;
      else if (type === T_CLOSE_PAREN) parens--;
      else if (type === T_COLON && parens === 0 && !customProperty) {
        // A depth-0 colon is a "Missed semicolon" / "Double colon" error,
        // unless it is the `progid:` hack (the colon right after the word
        // `progid`, which PostCSS's `colon()` skips over).
        const prevType = types[j - 1];
        const isProgid =
          prevType === T_WORD &&
          ends[j - 1] - starts[j - 1] === 6 &&
          css.startsWith("progid", starts[j - 1]);
        if (!isProgid) bail();
      } else if (type === T_WORD && css.charCodeAt(starts[j]) === BANG) {
        hasBang = true;
      }
    }

    // Exclusive end of the token range that still counts as the value, once
    // a trailing `!important` (and the whitespace right before it) is cut.
    let cleanEnd = count;
    if (customProperty) {
      // Trailing whitespace is part of a custom property's value.
      valueTo = ends[count - 1];
    } else if (valueFrom === -1) {
      // Empty value. Unlike `postcss-discard-empty`, this is kept, not
      // dropped; give it an empty (but valid) range right after the colon.
      valueTo = ends[valueStart - 1];
    } else if (hasBang) {
      let k = count - 1;
      while (
        k >= valueStart &&
        (types[k] === T_SPACE || types[k] === T_COMMENT)
      ) {
        k--;
      }
      const isTrailingImportant =
        k >= valueStart &&
        types[k] === T_WORD &&
        ends[k] - starts[k] === 10 &&
        css.slice(starts[k], ends[k]).toLowerCase() === "!important";

      const isBarewordImportant =
        !isTrailingImportant &&
        k >= valueStart &&
        types[k] === T_WORD &&
        ends[k] - starts[k] === 9 &&
        css.slice(starts[k], ends[k]).toLowerCase() === "important";
      const barewordEnd = isBarewordImportant
        ? findBarewordImportantEnd(
            css,
            types,
            starts,
            ends,
            firstRealIndex,
            k + 1,
            k,
          )
        : null;

      if (isTrailingImportant) {
        cleanEnd = k;
        while (cleanEnd - 1 > valueStart && types[cleanEnd - 1] === T_SPACE) {
          cleanEnd--;
        }
        // A bare `!important` strips down to an empty `[valueStart,
        // cleanEnd)`; the clean value below then correctly reads as "".
        // Unlike `postcss-discard-empty`, it is kept, not dropped.
      } else if (barewordEnd !== null) {
        cleanEnd = barewordEnd;
      } else if (this.current.fontFace) {
        // Not a recognized `!important` form; `@font-face` descriptors are
        // compared verbatim, so this scanner cannot classify them.
        bail();
      }
    }

    const end = ends[count - 1];
    const index = this.decls.push(
      propStart,
      ends[0],
      valueFrom === -1 ? valueTo : valueFrom,
      valueTo,
      end,
      (semi ? D_SEMI : 0) | (customProperty ? D_CUSTOM : 0),
    );
    if (hasComment || cleanEnd !== count) {
      // A non-empty value's leading trivia is promoted to `raws.between`
      // (not part of `value`) once PostCSS finds a real token later on;
      // only the truly-empty case keeps it as part of the (also empty)
      // value.
      const cleanStart = valueFrom === -1 ? valueStart : firstRealIndex;
      this.decls.clean.set(
        index,
        rawClean(css, types, starts, ends, cleanStart, cleanEnd),
      );
    }
    this.current.nodes?.push(index);
    this.semicolon = semi;
    this.spaces = semi ? semiEnd : end;
  }

  /**
   * A `;` with no preceding statement. If the previous sibling is a rule
   * without one already, it becomes that rule's own trailing semicolon
   * (`raws.ownSemicolon`, reusing `CssNode#semi`) and is removed along with
   * it; otherwise it is just more `before` text for whatever comes next.
   */
  private freeSemicolon(end: number): void {
    const nodes = this.current.nodes;
    if (nodes && nodes.length > 0) {
      const prev = nodes[nodes.length - 1];
      if (typeof prev !== "number" && prev.type === N_RULE && !prev.semi) {
        prev.semi = true;
        prev.end = end;
        // The rule's own span now reaches past the `;`, so the next node's
        // leading trivia must start fresh from there.
        this.spaces = end;
        return;
      }
    }
    // Not attached: the `;` is just more pending trivia for whatever comes
    // next. `this.spaces` already marks where that trivia run started
    // (unlike PostCSS's string accumulator, an offset doesn't need to grow
    // to "include" it) — touching it here would make it start later than
    // the previous structural boundary, and a since-removed node ahead
    // would then wrongly flush the gap in between as kept text.
  }

  private end(closeEnd: number): void {
    const current = this.current;
    if (current.parent === null) bail();
    this.closeContainer(current);
    current.end = closeEnd;
    this.current = current.parent;
    this.spaces = closeEnd;
  }

  private endFile(): void {
    if (this.current.parent !== null) bail();
    this.closeContainer(this.root);
  }

  private closeContainer(node: CssNode): void {
    if (node.nodes && node.nodes.length > 0) {
      node.semicolon = this.semicolon;
    }
    this.semicolon = false;
  }
}

function markDirty(node: CssNode | null): void {
  for (let n = node; n; n = n.parent) n.dirty = true;
}

class Optimizer {
  css: string;
  decls: Decls;
  options: SpliceOptimizerOptions;
  removed: number;

  constructor(css: string, decls: Decls, options: SpliceOptimizerOptions) {
    this.css = css;
    this.decls = decls;
    this.options = options;
    this.removed = 0;
  }

  /** Same order as `LazyResult#walkSync`: visitors first, then children. */
  visit(node: CssNode, all: boolean): void {
    if (node.type === N_RULE) {
      this.visitRule(node);
    } else if (node.type === N_AT_BLOCK || node.type === N_AT_STATEMENT) {
      this.visitAtRule(node);
    }
    if (node.removed) return;
    const nodes = node.nodes;
    if (!nodes) return;
    for (const child of nodes) {
      if (typeof child === "number" || child.removed) continue;
      if (all || child.dirty) {
        child.dirty = false;
        this.visit(child, all);
      }
    }
  }

  private visitRule(node: CssNode): void {
    // `node.selector` wins on a re-visit (triggered by `markDirty` on a
    // rewrite): the rewritten text is what a dirtied re-walk re-evaluates,
    // matching PostCSS's `walkRules` seeing the same mutated node again.
    const selector =
      node.selector ?? node.clean ?? this.css.slice(node.a, node.b);
    const pruned = pruneRuleSelector(selector, this.options);
    if (!pruned) return;
    this.removed += pruned.removed;
    if (pruned.selector === null) {
      node.removed = true;
      markDirty(node.parent);
    } else {
      node.selector = pruned.selector;
      markDirty(node);
    }
  }

  private visitAtRule(node: CssNode): void {
    const css = this.css;
    if (
      isFlatpickrKeyframes(
        node.name,
        node.clean ?? css.slice(node.a, node.b),
        this.options,
      )
    ) {
      node.removed = true;
      markDirty(node.parent);
      this.removed++;
      return;
    }

    if (!this.options.preserveAllIBMFonts && node.name === "font-face") {
      let family = "";
      let style = "";
      let weight = "";
      const decls = this.decls;
      const stack: Child[] = [];
      if (node.nodes) {
        for (let i = node.nodes.length - 1; i >= 0; i--) {
          stack.push(node.nodes[i]);
        }
      }
      while (stack.length > 0) {
        const child = stack.pop() as Child;
        if (typeof child === "number") {
          const prop = css.slice(decls.start[child], decls.propEnd[child]);
          if (
            prop === "font-family" ||
            prop === "font-style" ||
            prop === "font-weight"
          ) {
            const value =
              decls.clean.get(child) ??
              css.slice(decls.a[child], decls.b[child]);
            if (prop === "font-family") family = value;
            else if (prop === "font-style") style = value;
            else weight = value;
          }
        } else if (!child.removed && child.nodes) {
          for (let i = child.nodes.length - 1; i >= 0; i--) {
            stack.push(child.nodes[i]);
          }
        }
      }

      if (isUnusedIbmPlexFontFace(family, style, weight)) {
        node.removed = true;
        markDirty(node.parent);
        this.removed++;
      }
    }
  }

  run(root: CssNode): void {
    // PostCSS re-walks nodes dirtied by a visitor (rewritten rules and the
    // parents of removed nodes) until the tree settles. Replay that so the
    // visitors see the same sequence of calls.
    this.visit(root, true);
    while (root.dirty) {
      root.dirty = false;
      this.visit(root, false);
    }
    discardEmpty(root, this.css);
  }
}

/**
 * `postcss-discard-empty`, restricted to the cases the parser lets through.
 * A *named* `@layer` is never removed for being empty: real
 * `postcss-discard-empty` only drops it when an earlier sibling with the
 * same name already has content (order-establishing de-duplication), which
 * this scanner does not model (Group B: keep a duplicate/empty `@layer`
 * rather than replicate that). An anonymous `@layer {}` has no such
 * exemption and falls through to the ordinary empty-container rule below.
 */
function discardEmpty(node: CssNode, css: string): void {
  const nodes = node.nodes;
  if (!nodes) return;
  let kept = 0;
  for (const child of nodes) {
    if (typeof child === "number") {
      kept++;
      continue;
    }
    if (child.removed) continue;
    discardEmpty(child, css);
    if (!child.removed) kept++;
  }
  const isNamedLayer =
    node.type === N_AT_BLOCK &&
    node.name === "layer" &&
    (node.clean ?? css.slice(node.a, node.b)).trim() !== "";
  if (kept === 0 && node.type !== N_ROOT && !isNamedLayer) {
    node.removed = true;
  }
}

class Emitter {
  css: string;
  decls: Decls;
  out: string[];
  cursor: number;

  constructor(css: string, decls: Decls) {
    this.css = css;
    this.decls = decls;
    this.out = [];
    this.cursor = 0;
  }

  private flush(to: number): void {
    if (to > this.cursor) this.out.push(this.css.slice(this.cursor, to));
    this.cursor = to;
  }

  emit(root: CssNode): string {
    this.body(root);
    this.flush(this.css.length);
    return this.out.join("");
  }

  /** Mirror of the stringifier's `pushBody` semicolon rules. */
  private body(container: CssNode): void {
    const nodes = container.nodes as Child[];
    const decls = this.decls;
    let keptCount = 0;
    let last = -1;
    for (const node of nodes) {
      if (typeof node === "number") {
        last = keptCount;
      } else {
        if (node.removed) continue;
        if (node.type !== N_COMMENT) last = keptCount;
      }
      keptCount++;
    }

    // `Root#removeChild` hands a removed first child's `raws.before` to the
    // node that takes its place, so the first surviving root node keeps the
    // stylesheet's original leading whitespace.
    const first = nodes[0];
    const inherited =
      container.type === N_ROOT &&
      nodes.length > 1 &&
      typeof first !== "number" &&
      first.removed
        ? first
        : null;

    let i = 0;
    for (const node of nodes) {
      if (typeof node === "number") {
        if (inherited !== null && i === 0) {
          this.out.push(this.css.slice(inherited.before, inherited.start));
          this.cursor = decls.start[node];
        }
        this.statement(
          i,
          last,
          keptCount,
          container.semicolon,
          decls.end[node],
          (decls.flags[node] & D_SEMI) !== 0,
          (decls.flags[node] & D_CUSTOM) !== 0,
        );
        i++;
        continue;
      }

      if (node.removed) {
        this.flush(node.before);
        // A decl/at-statement's own `;` sits right after `end` (excluded
        // from it); a rule's own semicolon is already folded into `end`
        // (`Parser#freeSemicolon`), since it may not be adjacent to `}`.
        this.cursor =
          node.semi && node.type !== N_RULE ? node.end + 1 : node.end;
        continue;
      }

      if (inherited !== null && i === 0) {
        this.out.push(this.css.slice(inherited.before, inherited.start));
        this.cursor = node.start;
      }

      if (node.type === N_RULE) {
        if (node.selector !== null) {
          this.flush(node.a);
          this.out.push(node.selector);
          this.cursor = node.b;
        }
        this.body(node);
      } else if (node.type === N_AT_BLOCK) {
        this.body(node);
      } else if (node.type === N_AT_STATEMENT) {
        this.statement(
          i,
          last,
          keptCount,
          container.semicolon,
          node.end,
          node.semi,
          true,
        );
      }
      i++;
    }
  }

  /**
   * Semicolon after a declaration or at-rule statement. `forced` is true for
   * at-rule statements and custom properties, which always get one when a
   * sibling follows.
   */
  private statement(
    i: number,
    last: number,
    keptCount: number,
    containerSemicolon: boolean,
    end: number,
    semi: boolean,
    forced: boolean,
  ): void {
    let semicolon = i !== last || containerSemicolon;
    if (!semicolon && i < keptCount - 1 && forced) {
      semicolon = true;
    }
    if (semicolon !== semi) {
      this.flush(end);
      if (semicolon) {
        this.out.push(";");
      } else {
        this.cursor = end + 1;
      }
    }
  }
}

/**
 * Returns the optimized stylesheet, or the input unchanged (`removed: 0`)
 * when it is not the shape this scanner models: a syntax error, or a
 * construct whose effect on the allowlist it cannot compute. All shape
 * checks happen before any allowlist/safelist logic runs, so a bail leaves
 * caller-provided `RegExp` safelist entries untouched.
 */
export function spliceOptimizeCss(
  css: string,
  options: SpliceOptimizerOptions,
): { css: string; removed: number } {
  const parser = new Parser(css);
  let root: CssNode;
  try {
    root = parser.parse();
  } catch (error) {
    if (error !== BAIL) throw error;
    // A syntax error (PostCSS would throw `CssSyntaxError`), or a construct
    // whose effect on the Carbon allowlist this scanner cannot compute
    // (an ambiguous `@font-face` descriptor). Bundlers have already parsed
    // this asset before it reaches here, so a hard failure adds nothing;
    // returning it unchanged is the same contract `run()` already has for
    // assets with nothing optimizable.
    return { css, removed: 0 };
  }

  const decls = parser.decls;
  const optimizer = new Optimizer(css, decls, options);
  optimizer.run(root);
  return {
    css: new Emitter(css, decls).emit(root),
    removed: optimizer.removed,
  };
}

/**
 * Calls `onRule` with each rule's selector, in pre-order document order
 * (matching PostCSS's `root.walkRules()`, the reference this replaces).
 * The selector is PostCSS's clean value (comments dropped per the same
 * `raw()` rule used everywhere else in this module), not a raw splice of
 * the source. Unlike `spliceOptimizeCss`, there is no passthrough for a
 * bail: a build-time indexing pass has no "unchanged" to fall back to, so
 * an input outside this scanner's modeled shape is a hard error here.
 */
export function forEachRuleSelector(
  css: string,
  onRule: (selector: string) => void,
): void {
  let root: CssNode;
  try {
    root = new Parser(css).parse();
  } catch (error) {
    if (error === BAIL) {
      throw new Error(
        "forEachRuleSelector: input is outside the shape this scanner models",
      );
    }
    throw error;
  }

  const stack: CssNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as CssNode;
    if (node.type === N_RULE) {
      onRule(node.clean ?? css.slice(node.a, node.b));
    }
    const nodes = node.nodes;
    if (!nodes) continue;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const child = nodes[i];
      if (typeof child !== "number") stack.push(child);
    }
  }
}
