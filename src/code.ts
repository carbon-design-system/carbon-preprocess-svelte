/**
 * `carbon-preprocess-svelte/code`: what's safe to ship to the browser (no
 * Node APIs). The Markdown compiler, for previews of what `markdown()`
 * builds (`markdownToHtml`, `compileMarkdown`), and the code-block helpers
 * for a client-side code view: tokens for the CSS Custom Highlight API, a
 * fence's shown code and line marks, ANSI colors, and header icons.
 */
export { ansiToHtml, hasAnsi, stripAnsi } from "./markdown/ansi";
export { carbonCodeIcon } from "./markdown/code-icons";
export {
  type CodeIcon,
  type CodeIconTarget,
  type CompiledMarkdown,
  compileMarkdown,
  type MarkdownHeading,
  type MarkdownHtmlOptions,
  type MarkdownOptions,
  markdownToHtml,
} from "./markdown/compile";
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
  type CodeMeta,
  type PreparedFence,
  parseCodeMeta,
  prepareFence,
  renderCodeLines,
  type TerminalLines,
  terminalLines,
} from "./markdown/lines";
