/**
 * A small, dependency-free syntax highlighter for the languages docs use:
 * JavaScript/TypeScript, Svelte/HTML, CSS, JSON, shell, and diffs.
 *
 * `tokenize` is pure and runs anywhere, so the same tokens serve two
 * renderers: `highlight` emits `<span class="tok-…">` at build time, and in
 * the browser the token offsets can feed the CSS Custom Highlight API with
 * no DOM changes at all. Token types are named after Carbon's `syntax-*`
 * theme tokens (`tok-keyword` is colored by `--cds-syntax-keyword`).
 */
import { escapeText } from "./inline";
import { skipExpression } from "./scan";

export type TokenType =
  | "angleBracket"
  | "attributeName"
  | "attributeValue"
  | "bool"
  | "brace"
  | "bracket"
  | "className"
  | "color"
  | "comment"
  | "controlKeyword"
  | "definition"
  | "definitionKeyword"
  | "deleted"
  | "function"
  | "inserted"
  | "keyword"
  | "meta"
  | "moduleKeyword"
  | "null"
  | "number"
  | "operator"
  | "paren"
  | "propertyName"
  | "punctuation"
  | "regexp"
  | "self"
  | "special"
  | "string"
  | "tagName"
  | "typeName"
  | "unit"
  | "variableName";

/** A run of source text; `type` is `null` for plain text. */
export interface Token {
  type: TokenType | null;
  text: string;
}

type Lexer = (code: string, out: Token[]) => void;

const CONTROL = new Set(
  "if else for while do switch case default break continue return throw try catch finally await yield".split(
    " ",
  ),
);
const MODULE = new Set(["import", "export", "from"]);
const DEFINITION = new Set(
  "const let var function class extends interface type enum".split(" "),
);
const KEYWORDS = new Set(
  "new typeof instanceof in of delete void async as satisfies keyof readonly declare implements public private protected static get set abstract".split(
    " ",
  ),
);

const JS_COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y;
const JS_STRING =
  /`(?:\\[\s\S]|[^`\\])*`?|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/y;
const JS_REGEXP =
  /\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuvy]*/y;
const JS_NUMBER =
  /(?:0[xob][\da-f_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:e[+-]?\d+)?)n?/iy;
const IDENTIFIER = /[A-Za-z_$][\w$]*/y;
const JS_OPERATOR =
  /=>|\+\+|--|\.\.\.|\?\?=?|\?\.|[=!]==?|[<>]{1,3}=?|&&=?|\|\|=?|\*\*=?|[-+*/%&|^~!?:=]=?/y;
const WHITESPACE = /\s+/y;
const PUNCTUATION = /[{}()[\];,.:]/y;
const UPPERCASE = /^[A-Z]/;
const TS_PRIMITIVES = new Set(
  "string number boolean any unknown never void object bigint symbol".split(
    " ",
  ),
);
const TYPE_POSITION = new Set([":", "|", "&", "<", ",", "=>"]);
const NEXT_IS_CALL = /\s*\(/y;
const NEXT_IS_COLON = /\s*:/y;

/** Previous non-plain token, for context-dependent identifiers. */
function lastSignificant(out: Token[]): Token | undefined {
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].type !== null || out[i].text.trim() !== "") return out[i];
  }
  return undefined;
}

/** Whether a `/` here starts a regular expression rather than division. */
function regexAllowed(previous: Token | undefined): boolean {
  if (!previous) return true;
  if (previous.type === "operator" || previous.type === "punctuation") {
    return true;
  }
  if (previous.text === "(" || previous.text === "[" || previous.text === "{") {
    return true;
  }
  return (
    previous.type === "controlKeyword" ||
    previous.type === "keyword" ||
    previous.type === "moduleKeyword"
  );
}

function sticky(pattern: RegExp, code: string, at: number): string | null {
  pattern.lastIndex = at;
  const match = pattern.exec(code);
  return match ? match[0] : null;
}

/**
 * A lexer rule: a sticky pattern, the token type for its match (or a
 * function choosing one), and an optional guard on the current state.
 */
type Rule<State> = [
  pattern: RegExp,
  type:
    | TokenType
    | null
    | ((text: string, at: number, state: State) => TokenType | null),
  when?: (state: State) => boolean,
];

/**
 * Run `rules` over `code`. The first matching rule wins; a character no rule
 * matches is plain text. `after` sees each token, to update the state.
 */
function runRules<State>(
  code: string,
  out: Token[],
  rules: Rule<State>[],
  state: State,
  after?: (token: Token, state: State) => void,
): void {
  let pos = 0;
  while (pos < code.length) {
    let token: Token = { type: null, text: code[pos] };
    for (const [pattern, type, when] of rules) {
      if (when && !when(state)) continue;
      const text = sticky(pattern, code, pos);
      if (!text) continue;
      token = {
        type: typeof type === "function" ? type(text, pos, state) : type,
        text,
      };
      break;
    }
    out.push(token);
    after?.(token, state);
    pos += token.text.length;
  }
}

function punctuationType(c: string): TokenType | null {
  if (c === "{" || c === "}") return "brace";
  if (c === "(" || c === ")") return "paren";
  if (c === "[" || c === "]") return "bracket";
  return ";,.:".includes(c) ? "punctuation" : null;
}

interface ScriptState {
  code: string;
  out: Token[];
}

const SCRIPT_RULES: Rule<ScriptState>[] = [
  [WHITESPACE, null],
  [JS_COMMENT, "comment"],
  [JS_REGEXP, "regexp", (state) => regexAllowed(lastSignificant(state.out))],
  [JS_STRING, "string"],
  [JS_NUMBER, "number"],
  [
    IDENTIFIER,
    (text, at, state) => classifyIdentifier(text, state.code, at, state.out),
  ],
  [JS_OPERATOR, "operator"],
  [PUNCTUATION, (text) => punctuationType(text)],
];

const lexScript: Lexer = (code, out) => {
  runRules(code, out, SCRIPT_RULES, { code, out });
};

function classifyIdentifier(
  name: string,
  code: string,
  pos: number,
  out: Token[],
): TokenType | null {
  const previous = lastSignificant(out);
  if (previous?.text === "." || previous?.text === "?.") {
    NEXT_IS_CALL.lastIndex = pos + name.length;
    return NEXT_IS_CALL.test(code) ? "function" : "propertyName";
  }
  if (CONTROL.has(name)) return "controlKeyword";
  if (MODULE.has(name)) return "moduleKeyword";
  if (DEFINITION.has(name)) return "definitionKeyword";
  if (KEYWORDS.has(name)) return "keyword";
  if (name === "true" || name === "false") return "bool";
  if (name === "null" || name === "undefined") return "null";
  if (name === "this" || name === "super") return "self";
  if (previous?.type === "definitionKeyword") return "definition";
  NEXT_IS_CALL.lastIndex = pos + name.length;
  if (NEXT_IS_CALL.test(code)) return "function";
  if (UPPERCASE.test(name)) return "typeName";
  // TypeScript's built-in types, in a type position: `role: string`.
  if (TS_PRIMITIVES.has(name) && previous && TYPE_POSITION.has(previous.text)) {
    return "typeName";
  }
  return null;
}

const CSS_COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/y;
const CSS_STRING = /"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/y;
const CSS_NUMBER = /-?(?:\d+\.?\d*|\.\d+)/y;
const CSS_UNIT = /%|[a-z]+/iy;
const CSS_COLOR = /#[\da-f]{3,8}\b/iy;
const CSS_AT_RULE = /@[\w-]+/y;
const CSS_IDENT = /-?-?[A-Za-z_][\w-]*/y;
const CSS_SELECTOR_MARK = /[.#:]{1,2}-?[A-Za-z_][\w-]*/y;

interface CssState {
  code: string;
  /** Inside a rule's braces or a media query's parentheses: declarations. */
  depth: number;
  /** The previous token was a number, so letters right after are its unit. */
  number: boolean;
}

function cssIdentifier(
  text: string,
  at: number,
  state: CssState,
): TokenType | null {
  NEXT_IS_CALL.lastIndex = at + text.length;
  if (NEXT_IS_CALL.test(state.code)) return "function";
  if (state.depth === 0) return "tagName";
  NEXT_IS_COLON.lastIndex = at + text.length;
  if (NEXT_IS_COLON.test(state.code)) return "propertyName";
  return text.startsWith("--") ? "variableName" : null;
}

const CSS_RULES: Rule<CssState>[] = [
  [WHITESPACE, null],
  [CSS_COMMENT, "comment"],
  [CSS_STRING, "string"],
  [CSS_AT_RULE, "keyword"],
  [CSS_COLOR, "color", (state) => state.depth > 0],
  [
    CSS_SELECTOR_MARK,
    (text) => (text[0] === ":" ? "special" : "className"),
    (state) => state.depth === 0,
  ],
  [CSS_NUMBER, "number", (state) => state.depth > 0],
  [CSS_UNIT, "unit", (state) => state.number],
  [CSS_IDENT, cssIdentifier],
  [PUNCTUATION, (text) => punctuationType(text)],
];

const lexCss: Lexer = (code, out) => {
  runRules(
    code,
    out,
    CSS_RULES,
    { code, depth: 0, number: false },
    (token, state) => {
      if (token.text === "{" || token.text === "(") state.depth++;
      if (token.text === "}" || token.text === ")") {
        state.depth = Math.max(0, state.depth - 1);
      }
      state.number = token.type === "number";
    },
  );
};

const MARKUP_COMMENT = /<!--[\s\S]*?(?:-->|$)/y;
const TAG_OPEN = /<\/?(?=[A-Za-z])/y;
const TAG_NAME = /[A-Za-z][\w.:-]*/y;
const ATTRIBUTE_NAME = /[^\s=/>{"']+/y;
const QUOTED = /"[^"]*"?|'[^']*'?/y;
const UNQUOTED = /[^\s>"'`=<]+/y;
const BLOCK_TAG = /[#:/@][A-Za-z]+/y;
const TEXT = /[^<{]+/y;

/** `{expression}` or `{#if …}`: braces, a block keyword, and the script inside. */
function lexMustache(code: string, pos: number, out: Token[]): number {
  const end = skipExpression(code, pos);
  const stop = end < 0 ? code.length : end;
  out.push({ type: "brace", text: "{" });
  let inner = code.slice(pos + 1, end < 0 ? stop : stop - 1);
  const block = sticky(BLOCK_TAG, inner, 0);
  if (block) {
    out.push({ type: "controlKeyword", text: block });
    inner = inner.slice(block.length);
  }
  lexScript(inner, out);
  if (end >= 0) out.push({ type: "brace", text: "}" });
  return stop;
}

/**
 * A quoted attribute value. Svelte reads `{…}` inside the quotes as an
 * expression (`on:click="{() => log("x")}"`), so those parts are script.
 */
function lexQuotedValue(code: string, start: number, out: Token[]): number {
  const quote = code[start];
  let text = quote;
  let pos = start + 1;
  const flushText = () => {
    if (text) out.push({ type: "attributeValue", text });
    text = "";
  };
  while (pos < code.length && code[pos] !== quote) {
    if (code[pos] === "{") {
      flushText();
      pos = lexMustache(code, pos, out);
      continue;
    }
    text += code[pos];
    pos++;
  }
  if (pos < code.length) {
    text += quote;
    pos++;
  }
  flushText();
  return pos;
}

/** A tag's attributes, up to its `>` or `/>`. Returns where they end. */
function lexAttributes(code: string, start: number, out: Token[]): number {
  let pos = start;
  while (
    pos < code.length &&
    code[pos] !== ">" &&
    !code.startsWith("/>", pos)
  ) {
    if (code[pos] === "{") {
      pos = lexMustache(code, pos, out);
      continue;
    }
    if ((code[pos] === '"' || code[pos] === "'") && out.at(-1)?.text === "=") {
      pos = lexQuotedValue(code, pos, out);
      continue;
    }
    const afterEquals = out.at(-1)?.text === "=";
    const whitespace = sticky(WHITESPACE, code, pos);
    const quoted = whitespace ? null : sticky(QUOTED, code, pos);
    const unquoted =
      whitespace || quoted || !afterEquals ? null : sticky(UNQUOTED, code, pos);
    const name =
      whitespace || quoted || unquoted
        ? null
        : sticky(ATTRIBUTE_NAME, code, pos);
    const token: Token = whitespace
      ? { type: null, text: whitespace }
      : code[pos] === "="
        ? { type: "operator", text: "=" }
        : quoted || unquoted
          ? { type: "attributeValue", text: (quoted ?? unquoted) as string }
          : name
            ? { type: "attributeName", text: name }
            : { type: null, text: code[pos] };
    out.push(token);
    pos += token.text.length;
  }
  return pos;
}

const lexMarkup: Lexer = (code, out) => {
  let pos = 0;
  while (pos < code.length) {
    const comment = sticky(MARKUP_COMMENT, code, pos);
    if (comment) {
      out.push({ type: "comment", text: comment });
      pos += comment.length;
      continue;
    }
    if (code[pos] === "{") {
      pos = lexMustache(code, pos, out);
      continue;
    }
    const open = sticky(TAG_OPEN, code, pos);
    if (!open) {
      const text = sticky(TEXT, code, pos) ?? code[pos];
      out.push({ type: null, text });
      pos += text.length;
      continue;
    }
    out.push({ type: "angleBracket", text: open });
    pos += open.length;
    const name = sticky(TAG_NAME, code, pos) ?? "";
    out.push({ type: "tagName", text: name });
    pos = lexAttributes(code, pos + name.length, out);
    const close = code.startsWith("/>", pos)
      ? "/>"
      : code[pos] === ">"
        ? ">"
        : "";
    if (close) out.push({ type: "angleBracket", text: close });
    pos += close.length;
    // The insides of `<script>` and `<style>` are another language.
    const lower = name.toLowerCase();
    if (
      open === "<" &&
      close === ">" &&
      (lower === "script" || lower === "style")
    ) {
      const end = code.indexOf(`</${lower}`, pos);
      const stop = end < 0 ? code.length : end;
      (lower === "script" ? lexScript : lexCss)(code.slice(pos, stop), out);
      pos = stop;
    }
  }
};

const JSON_STRING = /"(?:\\.|[^"\\\n])*"?/y;

const JSON_RULES: Rule<{ code: string }>[] = [
  [WHITESPACE, null],
  [
    JSON_STRING,
    (text, at, state) => {
      NEXT_IS_COLON.lastIndex = at + text.length;
      return NEXT_IS_COLON.test(state.code) ? "propertyName" : "string";
    },
  ],
  [CSS_NUMBER, "number"],
  [
    IDENTIFIER,
    (text) =>
      text === "null"
        ? "null"
        : text === "true" || text === "false"
          ? "bool"
          : null,
  ],
  [PUNCTUATION, (text) => punctuationType(text)],
];

const lexJson: Lexer = (code, out) => {
  runRules(code, out, JSON_RULES, { code });
};

const SHELL_LINE = /[^\n]*\n?/g;
const SHELL_TOKEN =
  /(#.*)|("(?:\\.|[^"\\])*"?|'[^']*'?)|(\$\{[^}]*\}?|\$[\w@*#?$!-]+)|(\s--?[\w-]+(?:=\S*)?)|(\|\|?|&&|;|>>?|<|&)|([^\s"'$|&;<>#]+)|(\s+)|([\s\S])/g;
const SPACE_BEFORE = /\s/;

const lexShell: Lexer = (code, out) => {
  for (const line of code.match(SHELL_LINE) ?? []) {
    let command = true;
    for (const m of line.matchAll(SHELL_TOKEN)) {
      const [text, comment, string, variable, flag, operator, word] = m;
      const at = m.index ?? 0;
      if (
        comment !== undefined &&
        (at === 0 || SPACE_BEFORE.test(line[at - 1]))
      ) {
        out.push({ type: "comment", text });
      } else if (string !== undefined) {
        out.push({ type: "string", text });
      } else if (variable !== undefined) {
        out.push({ type: "variableName", text });
      } else if (flag !== undefined) {
        const space = flag.length - flag.trimStart().length;
        out.push({ type: null, text: flag.slice(0, space) });
        out.push({ type: "attributeName", text: flag.slice(space) });
      } else if (operator !== undefined) {
        out.push({ type: "operator", text });
        command = true;
      } else if (word !== undefined) {
        out.push({ type: command ? "function" : null, text });
        command = false;
      } else {
        out.push({ type: null, text });
      }
    }
  }
};

const lexDiff: Lexer = (code, out) => {
  for (const line of code.match(SHELL_LINE) ?? []) {
    const type = line.startsWith("+")
      ? "inserted"
      : line.startsWith("-")
        ? "deleted"
        : line.startsWith("@@")
          ? "meta"
          : null;
    out.push({ type, text: line });
  }
};

const LEXERS: Record<string, Lexer> = {
  js: lexScript,
  javascript: lexScript,
  mjs: lexScript,
  cjs: lexScript,
  jsx: lexScript,
  ts: lexScript,
  typescript: lexScript,
  tsx: lexScript,
  svelte: lexMarkup,
  html: lexMarkup,
  xml: lexMarkup,
  svg: lexMarkup,
  css: lexCss,
  scss: lexCss,
  json: lexJson,
  jsonc: lexScript,
  sh: lexShell,
  bash: lexShell,
  shell: lexShell,
  zsh: lexShell,
  diff: lexDiff,
};

/** Tokens for `code` in `lang`, or `undefined` for a language it doesn't know. */
export function tokenize(code: string, lang: string): Token[] | undefined {
  const lexer = LEXERS[lang.toLowerCase()];
  if (!lexer) return undefined;
  const out: Token[] = [];
  lexer(code, out);
  return out;
}

const KEBAB = /[A-Z]/g;

/** `controlKeyword` -> `control-keyword`, matching Carbon's `syntax-*` token names. */
export function tokenName(type: TokenType): string {
  return type.replace(KEBAB, (c) => `-${c.toLowerCase()}`);
}

/**
 * Highlight `code` as HTML spans (`<span class="tok-keyword">`), for the
 * `highlight` option of `markdown()`. Returns `undefined` for languages it
 * doesn't know, which leaves the block plain.
 */
export function highlight(code: string, lang: string): string | undefined {
  const tokens = tokenize(code, lang);
  if (!tokens) return undefined;
  let html = "";
  for (const { type, text } of tokens) {
    const escaped = escapeText(text);
    html += type
      ? `<span class="tok-${tokenName(type)}">${escaped}</span>`
      : escaped;
  }
  return html;
}
