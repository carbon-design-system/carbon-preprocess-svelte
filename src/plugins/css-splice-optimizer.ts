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
 * pure text edit. Anything outside that shape returns `undefined` and the
 * caller falls back to PostCSS; the scanner never guesses.
 *
 * Fidelity is by construction: the tokenizer and statement parser below
 * mirror `postcss/lib/tokenize` and `postcss/lib/parser` case by case
 * (including their quirks, e.g. the `url(` lookbehind buffer and
 * `RE_BAD_BRACKET`), the visitor pass replays PostCSS's dirty-node re-walk,
 * and the emitter reproduces `postcss/lib/stringifier`'s semicolon rules.
 * Constructs where PostCSS output is not a plain splice of the input
 * (comments inside a selector/declaration, empty declarations, free
 * semicolons, BOMs, `<` escaping, source-map annotations, `@layer`, ...)
 * bail.
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

const IMPORTANT_ONLY = /^![\t\n\f\r ]*important$/i;

/** Thrown to abandon the splice path; never escapes `spliceOptimizeCss`. */
const BAIL = Symbol("bail");

function bail(): never {
  throw BAIL;
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
 */
class Decls {
  start: Int32Array;
  propEnd: Int32Array;
  a: Int32Array;
  b: Int32Array;
  end: Int32Array;
  flags: Uint8Array;
  count: number;

  constructor(capacity: number) {
    this.start = new Int32Array(capacity);
    this.propEnd = new Int32Array(capacity);
    this.a = new Int32Array(capacity);
    this.b = new Int32Array(capacity);
    this.end = new Int32Array(capacity);
    this.flags = new Uint8Array(capacity);
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
    this.pos = 0;
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
    this.spaces = 0;
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
      } else if (type === T_SEMICOLON || type === T_OPEN_CURLY) {
        // A free semicolon lands in `raws.ownSemicolon` or the next node's
        // `before`; a bare `{` is a rule with an empty selector that
        // `postcss-discard-empty` drops. Neither is a plain splice.
        bail();
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
    // `postcss-discard-empty` has layer-specific rules.
    if (name === "layer") bail();

    const node = new CssNode(N_AT_BLOCK, this.current, this.spaces);
    this.init(node);
    node.start = t.start;
    node.name = name;
    if (name === "font-face") node.fontFace = true;

    const brackets: number[] = [];
    let open = false;
    let semi = false;
    let closedByParent = false;
    let paramsFrom = -1;
    let paramsTo = -1;
    let commentInside = false;
    let pendingComment = false;

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
      // `afterName` / `between`; a comment between two params tokens would
      // be stripped from `node.params`, which is not modeled.
      if (type === T_SPACE || type === T_COMMENT) {
        if (type === T_COMMENT && paramsFrom !== -1) pendingComment = true;
      } else {
        if (paramsFrom === -1) paramsFrom = t.start;
        if (pendingComment) commentInside = true;
        paramsTo = t.end;
      }
    }

    if (commentInside) bail();
    if (paramsFrom !== -1) {
      node.a = paramsFrom;
      node.b = paramsTo;
    }

    if (open) {
      this.current = node;
      this.spaces = t.end;
      return;
    }

    node.type = N_AT_STATEMENT;
    node.nodes = null;
    // `@foo;` with no params is dropped by `postcss-discard-empty`.
    if (paramsFrom === -1) bail();

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
      // EOF: trailing whitespace moves to `root.raws.after`.
      node.end = paramsTo;
      this.spaces = paramsTo;
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

  private rule(): void {
    const types = this.tokTypes;
    const ends = this.tokEnds;
    // Drop the `{`.
    let count = this.tokCount - 1;
    const bodyStart = ends[count];
    while (count > 0) {
      const last = types[count - 1];
      if (last !== T_SPACE && last !== T_COMMENT) break;
      count--;
    }
    for (let i = 0; i < count; i++) {
      // A comment inside the selector is stripped from `node.selector`.
      if (types[i] === T_COMMENT) bail();
    }

    const node = new CssNode(N_RULE, this.current, this.spaces);
    this.init(node);
    node.start = this.tokStarts[0];
    node.a = node.start;
    node.b = ends[count - 1];
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

    // PostCSS moves leading non-word tokens into `raws.before` and applies
    // the `*`/`_` hack; neither shape is modeled.
    if (types[0] !== T_WORD) bail();
    const first = css.charCodeAt(starts[0]);
    if (first === UNDERSCORE || first === ASTERISK) bail();

    // Only whitespace may separate the property from its colon; anything
    // else lands in `raws.between` or throws.
    let i = 1;
    let sawColon = false;
    for (; i < count; i++) {
      const type = types[i];
      if (type === T_COLON) {
        sawColon = true;
        i++;
        break;
      }
      if (type !== T_SPACE) bail();
    }
    if (!sawColon) bail();

    let valueFrom = -1;
    let valueTo = -1;
    let hasBang = false;
    let parens = 0;
    for (; i < count; i++) {
      const type = types[i];
      if (type === T_COMMENT) bail();
      if (type === T_SPACE) continue;
      if (valueFrom === -1) valueFrom = starts[i];
      valueTo = ends[i];
      if (type === T_OPEN_PAREN) parens++;
      else if (type === T_CLOSE_PAREN) parens--;
      else if (type === T_COLON && parens === 0 && !customProperty) {
        // "Missed semicolon" / "Double colon" errors, or the `progid:` hack.
        bail();
      } else if (type === T_WORD && css.charCodeAt(starts[i]) === BANG) {
        hasBang = true;
      }
    }

    if (customProperty) {
      // Trailing whitespace is part of a custom property's value.
      valueTo = ends[count - 1];
    } else if (valueFrom === -1) {
      // Empty value: dropped by `postcss-discard-empty`.
      bail();
    } else if (hasBang) {
      // `!important` handling rewrites the value; only bail where it matters:
      // a bare `!important` is an empty value, and `@font-face` descriptors
      // are compared verbatim.
      if (IMPORTANT_ONLY.test(css.slice(valueFrom, valueTo))) bail();
      if (this.current.fontFace) bail();
    }

    const end = ends[count - 1];
    const index = this.decls.push(
      starts[0],
      ends[0],
      valueFrom === -1 ? valueTo : valueFrom,
      valueTo,
      end,
      (semi ? D_SEMI : 0) | (customProperty ? D_CUSTOM : 0),
    );
    this.current.nodes?.push(index);
    this.semicolon = semi;
    this.spaces = semi ? semiEnd : end;
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
    const selector = node.selector ?? this.css.slice(node.a, node.b);
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
      isFlatpickrKeyframes(node.name, css.slice(node.a, node.b), this.options)
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
          if (prop === "font-family") {
            family = css.slice(decls.a[child], decls.b[child]);
          } else if (prop === "font-style") {
            style = css.slice(decls.a[child], decls.b[child]);
          } else if (prop === "font-weight") {
            weight = css.slice(decls.a[child], decls.b[child]);
          }
        } else if (child.removed) {
        } else if (child.nodes) {
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
    discardEmpty(root);
  }
}

/** `postcss-discard-empty`, restricted to the cases the parser lets through. */
function discardEmpty(node: CssNode): void {
  const nodes = node.nodes;
  if (!nodes) return;
  let kept = 0;
  for (const child of nodes) {
    if (typeof child === "number") {
      kept++;
      continue;
    }
    if (child.removed) continue;
    discardEmpty(child);
    if (!child.removed) kept++;
  }
  if (kept === 0 && node.type !== N_ROOT) {
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
        this.cursor = node.semi ? node.end + 1 : node.end;
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
 * Returns the optimized stylesheet, or `undefined` when the input falls
 * outside the modeled shape and must go through PostCSS instead. All shape
 * checks happen before any allowlist/safelist logic runs, so a bail leaves
 * caller-provided `RegExp` safelist entries untouched.
 */
export function spliceOptimizeCss(
  css: string,
  options: SpliceOptimizerOptions,
): { css: string; removed: number } | undefined {
  const first = css.charCodeAt(0);
  if (first === BOM || first === BOM_REVERSED) return undefined;
  // The stringifier escapes `<` in `</style` and `<!--`; a map annotation
  // makes PostCSS strip it and emit a source map.
  if (css.includes("<") || css.includes("sourceMappingURL")) return undefined;

  const parser = new Parser(css);
  let root: CssNode;
  try {
    root = parser.parse();
  } catch (error) {
    if (error === BAIL) return undefined;
    throw error;
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
 * Calls `onRule` with every rule's selector in document order (the order
 * `Root#walkRules` visits them), parsing with the splice tokenizer instead
 * of building a PostCSS AST. Returns `false` without calling `onRule` when
 * the stylesheet falls outside the modeled shape, so the caller can fall
 * back to PostCSS.
 */
export function forEachRuleSelector(
  css: string,
  onRule: (selector: string) => void,
): boolean {
  const first = css.charCodeAt(0);
  if (first === BOM || first === BOM_REVERSED) return false;

  let root: CssNode;
  try {
    root = new Parser(css).parse();
  } catch (error) {
    if (error === BAIL) return false;
    throw error;
  }

  const stack: CssNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as CssNode;
    if (node.type === N_RULE) onRule(css.slice(node.a, node.b));
    const nodes = node.nodes;
    if (!nodes) continue;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const child = nodes[i];
      if (typeof child !== "number") stack.push(child);
    }
  }

  return true;
}
