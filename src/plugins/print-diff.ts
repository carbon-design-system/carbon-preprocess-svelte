import { BYTES_PER_KB, LOG_PREFIX } from "../constants";
import { byteLength } from "../utils";

export type AssetDiff = {
  id: string;
  originalCss: Uint8Array | string;
  optimizedCss: string;
};

export type BuildSummary = {
  /** The stylesheets pruning made smaller. */
  assets: readonly AssetDiff[];
  /** Stylesheets with nothing to prune. */
  unchanged?: number;
  /** Carbon components `optimizeComponents` rewrote, when it reports here. */
  rewritten?: number;
  dryRun?: boolean;
  /**
   * ANSI color and weight. @default whether stdout is a terminal, after
   * `NO_COLOR` and `FORCE_COLOR`
   */
  color?: boolean;
};

/**
 * Rows shown before the rest fold into one; a single extra row
 * isn't folded.
 */
const ROWS = 5;
/**
 * A content hash in a file name, as bundlers write it:
 * `index-Ab12Cd.css`, `0.Ab12Cd.css`.
 */
const RE_HASH = /([.-][A-Za-z0-9_-]{4,})(?=\.css$)/;

let formatter: Intl.NumberFormat | undefined;

/**
 * `bytes` in kB with one decimal and thousands separators, so a column of
 * sizes lines up on its decimal point. The formatter is made on first use:
 * an `Intl.NumberFormat` costs milliseconds, and every tool that loads
 * `svelte.config.js` imports this module.
 */
function kb(bytes: number): string {
  formatter ??= new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${formatter.format(bytes / BYTES_PER_KB)} kB`;
}

function percent(before: number, after: number): string {
  return `-${Math.round(((before - after) / before) * 100)}%`;
}

/**
 * Whether to color output: `NO_COLOR` wins, then `FORCE_COLOR`, then
 * a terminal.
 */
export function useColor(
  stream: { isTTY?: boolean } = process.stdout,
): boolean {
  if (process.env.NO_COLOR) return false;
  const force = process.env.FORCE_COLOR;
  if (force !== undefined) return force !== "0" && force !== "false";
  return stream.isTTY === true;
}

const CODES = {
  bold: ["\x1b[1m", "\x1b[22m"],
  dim: ["\x1b[2m", "\x1b[22m"],
  green: ["\x1b[32m", "\x1b[39m"],
} as const;
type Style = keyof typeof CODES;

type Row = {
  /** The label's text, for its width. */
  text: string;
  /** The label as printed. */
  label: string;
  before: number;
  after: number;
};

/**
 * The build's pruning, as a header and a table: a row per stylesheet, the
 * largest savings first and the rest folded into one row past five, then
 * a total under a rule when there's more than one. Sizes, arrows and
 * percentages line up in columns. `null` when there's nothing to say.
 *
 *   carbon-preprocess-svelte: rewrote 37 Carbon components and pruned their CSS
 *     assets/index-Ab12Cd.css    772.5 kB  →  32.8 kB  -96%
 *     assets/About-Xy34Zw.css     38.0 kB  →   3.3 kB  -91%
 *                               ──────────────────────────
 *     2 stylesheets              810.5 kB  →  36.1 kB  -96%
 */
export function formatSummary(summary: BuildSummary): string | null {
  const { rewritten = 0, unchanged = 0, dryRun = false } = summary;
  const color = summary.color ?? useColor();
  // Each cell styled on its own, since bold and dim end with the same code.
  const paint = (text: string, ...styles: Style[]) =>
    color
      ? styles.reduce(
          (out, style) => CODES[style][0] + out + CODES[style][1],
          text,
        )
      : text;
  const prefix = paint(LOG_PREFIX, "bold");
  const components = `rewrote ${rewritten} Carbon component${rewritten === 1 ? "" : "s"}`;

  const sized = summary.assets
    .map(({ id, originalCss, optimizedCss }) => ({
      id,
      before: byteLength(originalCss),
      after: byteLength(optimizedCss),
    }))
    .filter(({ before, after }) => after < before);

  if (sized.length === 0) {
    if (rewritten > 0) return `${prefix} ${components}`;
    if (unchanged === 0) return null;
    return paint(
      `${LOG_PREFIX} nothing to prune in ${unchanged} stylesheet${unchanged === 1 ? "" : "s"}`,
      "dim",
    );
  }

  const saved = (row: { before: number; after: number }) =>
    row.before - row.after;
  const sorted = sized.sort((a, b) => saved(b) - saved(a));
  const shown = sorted.length > ROWS + 1 ? sorted.slice(0, ROWS) : sorted;
  const folded = sorted.slice(shown.length);
  const sum = (list: typeof sized) => ({
    before: list.reduce((total, row) => total + row.before, 0),
    after: list.reduce((total, row) => total + row.after, 0),
  });

  const rows: Row[] = shown.map(({ id, before, after }) => {
    const slash = Math.max(id.lastIndexOf("/"), id.lastIndexOf("\\")) + 1;
    const base = id.slice(slash);
    const hash = RE_HASH.exec(base);
    const name = hash
      ? base.slice(0, hash.index) +
        paint(hash[1], "dim") +
        base.slice(hash.index + hash[1].length)
      : base;
    return {
      text: id,
      label: paint(id.slice(0, slash), "dim") + name,
      before,
      after,
    };
  });
  if (folded.length > 0) {
    const text = `+ ${folded.length} more`;
    rows.push({ text, label: paint(text, "dim"), ...sum(folded) });
  }
  const total: Row | undefined =
    sized.length > 1
      ? (() => {
          const text = `${sized.length} stylesheets`;
          return { text, label: paint(text, "bold"), ...sum(sized) };
        })()
      : undefined;

  const all = total ? [...rows, total] : rows;
  const width = {
    label: Math.max(...all.map((row) => row.text.length)),
    before: Math.max(...all.map((row) => kb(row.before).length)),
    after: Math.max(...all.map((row) => kb(row.after).length)),
    percent: Math.max(
      ...all.map((row) => percent(row.before, row.after).length),
    ),
  };
  const line = (row: Row, bold: boolean) =>
    [
      `  ${row.label}${" ".repeat(width.label - row.text.length)}`,
      paint(kb(row.before).padStart(width.before), "dim"),
      paint("→", "dim"),
      bold
        ? paint(kb(row.after).padStart(width.after), "bold")
        : kb(row.after).padStart(width.after),
      bold
        ? paint(
            percent(row.before, row.after).padStart(width.percent),
            "green",
            "bold",
          )
        : paint(
            percent(row.before, row.after).padStart(width.percent),
            "green",
          ),
    ].join("  ");

  const action = dryRun
    ? `dry run, files unchanged: ${rewritten > 0 ? `${components}, would prune their CSS` : "would prune Carbon CSS"}`
    : rewritten > 0
      ? `${components} and pruned their CSS`
      : "pruned Carbon CSS";
  const header = `${prefix} ${action}`;
  const lines = [header, ...rows.map((row) => line(row, false))];
  if (total) {
    // The widths of before, " → ", after, " " and percent, so the columns
    // line up.
    const numbers = width.before + 5 + width.after + 2 + width.percent;
    lines.push(
      `  ${" ".repeat(width.label + 2)}${paint("─".repeat(numbers), "dim")}`,
    );
    lines.push(line(total, true));
  }
  return lines.join("\n");
}

/**
 * Logs the build's summary through `log` (Vite's `config.logger.info`)
 * when set, else `console.log`. Returns whether it logged anything.
 */
export function logSummary(
  summary: BuildSummary & { log?: (message: string) => void },
): boolean {
  const { log = console.log, ...rest } = summary;
  const message = formatSummary(rest);
  if (message === null) return false;
  log(message);
  return true;
}
