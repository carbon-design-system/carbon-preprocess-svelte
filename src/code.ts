/**
 * `carbon-preprocess-svelte/code`: the code-block helpers, safe to ship to
 * the browser (no Node APIs), for a client-side code view that renders what
 * `markdown()` renders at build time: tokens for the CSS Custom Highlight
 * API, a fence's shown code and line marks, ANSI colors, and header icons.
 */
export {
  type AnsiRun,
  type AnsiStyle,
  ansiToHtml,
  hasAnsi,
  parseAnsi,
  stripAnsi,
} from "./markdown/ansi";
export { carbonCodeIcon, carbonCodeIconName } from "./markdown/code-icons";
export type { CodeIcon, CodeIconTarget } from "./markdown/compile";
export {
  decodeTokens,
  encodeTokens,
  highlight,
  TOKEN_TYPES,
  type Token,
  type TokenRange,
  type TokenType,
  tokenize,
  tokenName,
} from "./markdown/highlight";
export {
  type CodeKind,
  type CodeMeta,
  type DiffLines,
  diffLines,
  type LineMark,
  type PreparedFence,
  parseCodeMeta,
  prepareFence,
  renderCodeLines,
  splitHtmlLines,
  stripCodeMarkers,
  type TerminalLines,
  terminalLines,
} from "./markdown/lines";
