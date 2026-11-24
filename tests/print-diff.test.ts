import { stripVTControlCharacters } from "node:util";
import {
  formatSummary,
  logSummary,
  useColor,
} from "carbon-preprocess-svelte/plugins/print-diff";

const FOLDED_ROW = /^ {2}\+ 2 more\s+20\.0 kB {2}→ {2}2\.0 kB {2}-90%$/;
const TOTAL_ROW = /^ {2}7 stylesheets\s+70\.0 kB/;

/** A stylesheet `before` bytes long, pruned to `after`. */
const asset = (id: string, before: number, after: number) => ({
  id,
  originalCss: "x".repeat(before),
  optimizedCss: "x".repeat(after),
});

describe("formatSummary", () => {
  test("one stylesheet: a header and a row", () => {
    expect(
      formatSummary({
        assets: [asset("assets/index-Ab12Cd.css", 849_760, 90_050)],
        rewritten: 37,
        color: false,
      }),
    ).toBe(
      [
        "carbon-preprocess-svelte: rewrote 37 Carbon components and pruned their CSS",
        "  assets/index-Ab12Cd.css  849.8 kB  →  90.1 kB  -89%",
      ].join("\n"),
    );
  });

  test("several: largest savings first, a rule, then an aligned total", () => {
    expect(
      formatSummary({
        assets: [
          asset("dist/b.css", 65_000, 7_300),
          asset("dist/a.css", 772_500, 27_000),
          asset("dist/c.css", 102_100, 12_100),
        ],
        color: false,
      }),
    ).toBe(
      [
        "carbon-preprocess-svelte: pruned Carbon CSS",
        "  dist/a.css     772.5 kB  →  27.0 kB  -97%",
        "  dist/c.css     102.1 kB  →  12.1 kB  -88%",
        "  dist/b.css      65.0 kB  →   7.3 kB  -89%",
        "                 ──────────────────────────",
        "  3 stylesheets  939.6 kB  →  46.4 kB  -95%",
      ].join("\n"),
    );
  });

  test("folds past five rows, but never a single one", () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        asset(`dist/${i}.css`, 10_000 - i, 1_000),
      );
    const lines = (n: number) =>
      (formatSummary({ assets: many(n), color: false }) ?? "").split("\n");
    expect(lines(6).some((line) => line.includes("more"))).toBe(false);
    expect(lines(7).find((line) => line.includes("more"))).toMatch(FOLDED_ROW);
    expect(lines(7).at(-1)).toMatch(TOTAL_ROW);
  });

  test("columns line up across rows", () => {
    const rows = (
      formatSummary({
        assets: [
          asset("dist/a-very-long-name.css", 1_234_567, 23_456),
          asset("dist/b.css", 9_000, 900),
        ],
        color: false,
      }) ?? ""
    )
      .split("\n")
      .slice(1)
      .filter((line) => line.includes("→"));
    const arrows = new Set(rows.map((line) => line.indexOf("→")));
    const ends = new Set(rows.map((line) => line.length));
    expect(arrows.size).toBe(1);
    expect(ends.size).toBe(1);
  });

  test("a dry run says so in the header", () => {
    expect(
      formatSummary({
        assets: [asset("dist/app.css", 606_260, 53_220)],
        dryRun: true,
        color: false,
      })?.split("\n")[0],
    ).toBe(
      "carbon-preprocess-svelte: dry run, files unchanged: would prune Carbon CSS",
    );
  });

  test("nothing pruned: one dim line, or nothing", () => {
    expect(formatSummary({ assets: [], unchanged: 2, color: false })).toBe(
      "carbon-preprocess-svelte: nothing to prune in 2 stylesheets",
    );
    expect(formatSummary({ assets: [], color: false })).toBeNull();
    expect(
      formatSummary({
        assets: [asset("a.css", 10, 10)],
        unchanged: 0,
        color: false,
      }),
    ).toBeNull();
    expect(formatSummary({ assets: [], rewritten: 1, color: false })).toBe(
      "carbon-preprocess-svelte: rewrote 1 Carbon component",
    );
  });

  test("color styles each cell, and leaves the text as without it", () => {
    const summary = {
      assets: [
        asset("dist/a-Ab12Cd.css", 772_500, 27_000),
        asset("dist/b.css", 65_000, 7_300),
      ],
    };
    const colored = formatSummary({ ...summary, color: true }) ?? "";
    expect(colored).toContain("\x1b[32m");
    expect(stripVTControlCharacters(colored)).toBe(
      formatSummary({ ...summary, color: false }),
    );
  });
});

describe("useColor", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  test("follows NO_COLOR, then FORCE_COLOR, then the terminal", () => {
    const { NO_COLOR: _noColor, FORCE_COLOR: _forceColor, ...rest } = env;
    process.env = rest;
    expect(useColor({ isTTY: true })).toBe(true);
    expect(useColor({ isTTY: false })).toBe(false);
    process.env.FORCE_COLOR = "1";
    expect(useColor({ isTTY: false })).toBe(true);
    process.env.FORCE_COLOR = "0";
    expect(useColor({ isTTY: true })).toBe(false);
    process.env.NO_COLOR = "1";
    process.env.FORCE_COLOR = "1";
    expect(useColor({ isTTY: true })).toBe(false);
  });
});

describe("logSummary", () => {
  test("logs through `log`, and says whether it did", () => {
    const messages: string[] = [];
    const log = (message: string) => messages.push(message);
    expect(
      logSummary({ assets: [asset("a.css", 20, 10)], color: false, log }),
    ).toBe(true);
    expect(messages).toHaveLength(1);
    expect(logSummary({ assets: [], color: false, log })).toBe(false);
    expect(messages).toHaveLength(1);
  });
});
