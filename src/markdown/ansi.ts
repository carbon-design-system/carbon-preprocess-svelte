/**
 * ANSI escape sequences (SGR) in terminal output, as HTML spans with
 * classes a stylesheet maps to theme tokens:
 *
 * - `ansi-bold`, `ansi-dim`, `ansi-italic`, `ansi-underline`, `ansi-strike`
 * - the 16 standard colors: `ansi-red`, `ansi-bright-red`, `ansi-bg-red`, …
 * - 256-color and truecolor: `ansi-rgb` with `--ansi-fg: #rrggbb` (and
 *   `ansi-bg-rgb` with `--ansi-bg`), for a stylesheet to keep the hue and
 *   adapt the lightness to the theme.
 *
 * Other control sequences (cursor moves, line clears) are removed.
 */
import { escapeText } from "./inline";

const NAMES = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
] as const;

// ESC [ params final-byte. With `literals`, also the spellings people type
// in docs: `\e[`, `\x1b[`, `\u001b[`, `\033[`.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the escape character is the point
const CSI = /\x1b\[([0-9;:?]*)([@-~])/g;
const CSI_OR_LITERAL =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching the escape character is the point
  /(?:\x1b|\\e|\\x1[bB]|\\u001[bB]|\\033)\[([0-9;:?]*)([@-~])/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the escape character is the point
const HAS_ESCAPE = /\x1b\[/;
const HAS_LITERAL = /(?:\\e|\\x1[bB]|\\u001[bB]|\\033)\[[0-9;]*m/;
const SGR_SEPARATOR = /[;:]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the escape character is the point
const OTHER_ESCAPES = /\x1b[@-Z\\-_]|\x1b\][^\x07]*\x07/g;

export interface AnsiStyle {
  /** A standard color name (`red`, `bright-red`) or a `#rrggbb` color. */
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

/** A run of text and the style it has. */
export interface AnsiRun {
  text: string;
  style: AnsiStyle;
}

/** Whether `text` has ANSI sequences (or, with `literals`, typed ones). */
export function hasAnsi(text: string, literals = false): boolean {
  return HAS_ESCAPE.test(text) || (literals && HAS_LITERAL.test(text));
}

const hex = (n: number) => n.toString(16).padStart(2, "0");

/** xterm's 256-color palette, from index 16 up (0–15 are the named colors). */
function color256(n: number): string | undefined {
  if (n < 0 || n > 255) return undefined;
  if (n < 16) return n < 8 ? NAMES[n] : `bright-${NAMES[n - 8]}`;
  if (n >= 232) {
    const gray = 8 + (n - 232) * 10;
    return `#${hex(gray)}${hex(gray)}${hex(gray)}`;
  }
  const i = n - 16;
  const level = (v: number) => (v === 0 ? 0 : 55 + v * 40);
  return `#${hex(level(Math.floor(i / 36)))}${hex(level(Math.floor(i / 6) % 6))}${hex(level(i % 6))}`;
}

/** Apply one SGR parameter list to a style. */
function applySgr(style: AnsiStyle, params: number[]): AnsiStyle {
  const next = { ...style };
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (p === 0) {
      for (const key of Object.keys(next)) delete next[key as keyof AnsiStyle];
    } else if (p === 1) next.bold = true;
    else if (p === 2) next.dim = true;
    else if (p === 3) next.italic = true;
    else if (p === 4) next.underline = true;
    else if (p === 9) next.strike = true;
    else if (p === 22) next.bold = next.dim = undefined;
    else if (p === 23) next.italic = undefined;
    else if (p === 24) next.underline = undefined;
    else if (p === 29) next.strike = undefined;
    else if (p >= 30 && p <= 37) next.fg = NAMES[p - 30];
    else if (p >= 90 && p <= 97) next.fg = `bright-${NAMES[p - 90]}`;
    else if (p >= 40 && p <= 47) next.bg = NAMES[p - 40];
    else if (p >= 100 && p <= 107) next.bg = `bright-${NAMES[p - 100]}`;
    else if (p === 39) next.fg = undefined;
    else if (p === 49) next.bg = undefined;
    else if (p === 38 || p === 48) {
      const key = p === 38 ? "fg" : "bg";
      if (params[i + 1] === 5) {
        next[key] = color256(params[i + 2]);
        i += 2;
      } else if (params[i + 1] === 2) {
        const [r, g, b] = params
          .slice(i + 2, i + 5)
          .map((v) => Math.min(255, Math.max(0, v || 0)));
        next[key] = `#${hex(r)}${hex(g)}${hex(b)}`;
        i += 4;
      }
    }
  }
  return next;
}

/**
 * Split text with ANSI sequences into styled runs, without the sequences.
 * Pass the style a previous line ended with to carry it across lines.
 */
export function parseAnsi(
  text: string,
  options: { literals?: boolean; style?: AnsiStyle } = {},
): { runs: AnsiRun[]; style: AnsiStyle } {
  const pattern = options.literals ? CSI_OR_LITERAL : CSI;
  pattern.lastIndex = 0;
  const clean = text.replace(OTHER_ESCAPES, "");
  const runs: AnsiRun[] = [];
  let style: AnsiStyle = options.style ?? {};
  let last = 0;
  for (const match of clean.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) runs.push({ text: clean.slice(last, index), style });
    last = index + match[0].length;
    // Only SGR (`m`) changes style; other sequences are dropped.
    if (match[2] === "m") {
      const params =
        match[1] === "" ? [0] : match[1].split(SGR_SEPARATOR).map(Number);
      style = applySgr(style, params);
    }
  }
  if (last < clean.length) runs.push({ text: clean.slice(last), style });
  return { runs, style };
}

/** Text without ANSI sequences. */
export function stripAnsi(text: string, literals = false): string {
  return parseAnsi(text, { literals })
    .runs.map((run) => run.text)
    .join("");
}

const isHex = (color: string) => color.startsWith("#");

/** Classes and inline style for one run. */
function attributesOf(style: AnsiStyle): string {
  const classes: string[] = [];
  const vars: string[] = [];
  for (const flag of [
    "bold",
    "dim",
    "italic",
    "underline",
    "strike",
  ] as const) {
    if (style[flag]) classes.push(`ansi-${flag}`);
  }
  if (style.fg) {
    if (isHex(style.fg)) {
      classes.push("ansi-rgb");
      vars.push(`--ansi-fg: ${style.fg}`);
    } else classes.push(`ansi-${style.fg}`);
  }
  if (style.bg) {
    if (isHex(style.bg)) {
      classes.push("ansi-bg-rgb");
      vars.push(`--ansi-bg: ${style.bg}`);
    } else classes.push(`ansi-bg-${style.bg}`);
  }
  if (classes.length === 0) return "";
  return ` class="${classes.join(" ")}"${vars.length ? ` style="${vars.join("; ")}"` : ""}`;
}

/**
 * HTML for text with ANSI sequences: escaped text in styled spans. Returns
 * the style the text ends with, to carry into the next line.
 */
export function ansiToHtml(
  text: string,
  options: { literals?: boolean; style?: AnsiStyle } = {},
): { html: string; style: AnsiStyle } {
  const { runs, style } = parseAnsi(text, options);
  const html = runs
    .map((run) => {
      const attributes = attributesOf(run.style);
      return attributes
        ? `<span${attributes}>${escapeText(run.text)}</span>`
        : escapeText(run.text);
    })
    .join("");
  return { html, style };
}
