import { getComponents } from "carbon-preprocess-svelte/component-index-registry";
import { ALWAYS_ON_CLASSES } from "carbon-preprocess-svelte/constants";
import {
  type SpliceOptimizerOptions,
  spliceOptimizeCss,
} from "carbon-preprocess-svelte/plugins/css-splice-optimizer";
import type { SafelistEntry } from "carbon-preprocess-svelte/plugins/safelist";
import { resolveCarbonCss } from "./helpers/carbon-css";
import { optimizeCssWithPostcss } from "./helpers/postcss-optimize-css";

/**
 * The splice optimizer must produce exactly what the PostCSS pipeline
 * produces for every input whose shape it fully models. Checked here
 * against the PostCSS pipeline as the reference: hand-written hostile
 * inputs cover each construct the scanner special-cases, and a seeded
 * fuzzer covers their combinations.
 *
 * `spliceOptimizeCss` never bails outright: a construct it does not model
 * either (a) is an intentional behavior change from PostCSS — a
 * round-tripping quirk deliberately not reproduced, e.g.
 * `postcss-discard-empty` deleting an empty declaration — or (b) is a
 * genuine syntax error (or a construct too ambiguous to classify), returned
 * unchanged with `removed: 0`, the same contract as an asset with nothing
 * optimizable. Neither can go through the parity checks above since the
 * PostCSS output is expected to differ (or PostCSS throws outright); they
 * are asserted directly instead, against a hand-written expectation, in
 * `describe("behavior changes", ...)` and `describe("syntax errors", ...)`.
 */

type Scenario = {
  ids: string[];
  preserveAllIBMFonts?: boolean;
  safelist?: SafelistEntry[];
};

const SCENARIOS: Record<string, Scenario> = {
  none: { ids: [] },
  button: { ids: ["Button"] },
  datepicker: { ids: ["DatePicker", "DatePickerInput"] },
  fonts: { ids: ["Button"], preserveAllIBMFonts: true },
  safelist: { ids: ["Accordion"], safelist: [".bx--grid", /^\.bx--btn--/] },
  // Stateful regexes make the visitor call sequence observable.
  safelistGlobal: { ids: ["Accordion"], safelist: [/bx--btn/g] },
};

function toOptions(scenario: Scenario): SpliceOptimizerOptions {
  const components = getComponents();
  const allowlist = new Set(ALWAYS_ON_CLASSES);
  for (const id of scenario.ids) {
    for (const cls of components[id]?.classes ?? []) allowlist.add(cls);
  }
  return {
    allowlist,
    preserveAllIBMFonts: scenario.preserveAllIBMFonts === true,
    preserveFlatpickr: scenario.ids.includes("DatePicker"),
    // Fresh RegExp instances so `lastIndex` starts equal for both runs.
    safelist: (scenario.safelist ?? []).map((entry) =>
      typeof entry === "string" ? entry : new RegExp(entry.source, entry.flags),
    ),
  };
}

type Outcome =
  | { ok: true; css: string; removed: number }
  | { ok: false; error: string };

function reference(source: string, scenario: Scenario): Outcome {
  try {
    const { css, removed } = optimizeCssWithPostcss(
      source,
      toOptions(scenario),
    );
    return { ok: true, css, removed };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

function spliced(source: string, scenario: Scenario): Outcome {
  return { ok: true, ...spliceOptimizeCss(source, toOptions(scenario)) };
}

function expectParity(source: string, scenario: Scenario): void {
  expect(spliced(source, scenario)).toEqual(reference(source, scenario));
}

/** A full, byte-for-byte passthrough: `spliceOptimizeCss`'s bail contract. */
function expectPassthrough(source: string, scenario: Scenario): void {
  expect(spliced(source, scenario)).toEqual({
    ok: true,
    css: source,
    removed: 0,
  });
}

const FF = (family: string, style: string, weight: string) =>
  `@font-face{font-family:${family};font-style:${style};font-weight:${weight}}`;

/** Inputs whose splice output must be byte-for-byte identical to PostCSS's. */
const HOSTILE: Record<string, string> = {
  "single kept": ".bx--btn{color:red}",
  "single removed": ".bx--unused{color:red}",
  "tabs crlf": ".bx--btn\r\n{\r\n\tcolor:red;\r\n}\r\n.bx--unused{x:y}\r\n",
  unicode: '.bx--btn::before{content:"→ ünïcödé"}.bx--ünused{x:y}',
  "leading ws inherited by new first node":
    "\n\n.bx--unused{a:b}\n.bx--btn{c:d}\n",
  "leading ws chain":
    ".bx--u1{}\n.bx--u2{a:b}\n\n.bx--u3{a:b}\n.bx--btn{a:b}\n.bx--u4{a:b}",
  "all removed": "\n.bx--unused{a:b}\n.bx--unused2{c:d}\n\n",
  "comment statements":
    "/* h */\n.bx--btn{/*c*/a:b/*d*/}\n.bx--unused{/*x*/}/* end */",
  "comment in selector": ".bx--btn, /*c*/ .bx--unused{a:b}",
  "comment trailing selector": ".bx--btn /*c*/ {a:b}.bx--unused/*c*/{a:b}",
  "comment in decl": ".bx--btn{a:b /*c*/;c:d}",
  "comment after last decl": ".bx--btn{a:b /*c*/}",
  "comment after custom decl": ".bx--btn{--x:1 /*c*/}",
  "comment around params": "@media /*a*/ screen /*b*/ {.bx--unused{a:b}}",
  "comment inside params": "@media screen /*b*/ and (x){.bx--unused{a:b}}",
  "comment between prop and colon": ".bx--btn{color /*c*/: red;a:b}",
  "leading comment in decl value": ".bx--btn{color: /*c*/ red}.bx--unused{a:b}",
  "string braces": '.bx--btn{content:"}{;"}.bx--unused{content:"{"}',
  "string escaped quote": ".bx--btn{content:'a\\'b'}.bx--unused{a:b}",
  "url data":
    ".bx--btn{background:url(data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E)}.bx--unused{a:b}",
  "url quoted paren": '.bx--btn{background:url("x)y")}.bx--unused{a:b}',
  "url unquoted quote": '.bx--btn{background:url(x"y)}.bx--unused{a:b}',
  "url escaped paren": ".bx--btn{background:url(a\\)b)}.bx--unused{a:b}",
  "url word stack": ".bx--btn{background:url x () (y'z)}.bx--unused{a:b}",
  "bad bracket u2028": '.bx--btn{a:( "x)}.bx--unused{a:b}',
  "attr brace": '.bx--btn[b="{"]{a:b}.bx--unused[b;c]{a:b}',
  "not is": ".bx--btn:not(.bx--unused){a:b}:is(.bx--btn, .bx--unused){a:b}",
  "stray close paren": ".bx--btn{a:b)}.bx--unused{a:)b:c}",
  media:
    "@media (min-width:1px){.bx--unused{a:b}.bx--btn{c:d}}@media x{.bx--unused{a:b}}@media y{}",
  "media brace in params": "@media (a{b){.bx--unused{a:b}}.bx--btn{c:d}",
  "font-face keep":
    FF("IBM Plex Sans", "normal", "400") + FF("IBM Plex Mono", "normal", "400"),
  "font-face drop":
    FF("IBM Plex Sans", "italic", "400") + FF("IBM Plex Sans", "normal", "700"),
  "font-face other":
    FF("Comic Sans", "normal", "700") + FF('"IBM Plex Sans"', "normal", "400"),
  "font-face spacing":
    "@font-face{font-family: IBM Plex Sans ;font-style:\tnormal;font-weight:\n400 }",
  "font-face important":
    "@font-face{font-family:IBM Plex Sans;font-style:normal;font-weight:400 !important}",
  "font-face upper":
    "@FONT-FACE{font-family:IBM Plex Sans;font-style:italic;font-weight:400}",
  "font-face empty": "@font-face{}.bx--btn{a:b}",
  "font-face nested":
    "@font-face{font-family:IBM Plex Sans;font-style:normal;font-weight:400;.bx--unused{a:b}}",
  "font-face duplicates":
    "@font-face{font-family:IBM Plex Sans;font-weight:400;font-style:italic;font-style:normal}",
  "font-face star hack":
    "@font-face{*font-family:IBM Plex Sans;font-style:normal;font-weight:700}",
  "font-face bareword important kept":
    "@font-face{font-family:IBM Plex Sans;font-style:normal;font-weight:400 ! z important}",
  "font-face bareword important dropped":
    "@font-face{font-family:IBM Plex Sans;font-style:normal;font-weight:700 ! z important}",
  keyframes:
    "@keyframes fpFadeInDown{from{opacity:0}to{opacity:1}}@keyframes  fpFadeInDown  {}@-webkit-keyframes fpFadeInDown{}",
  "keyframes comment":
    "@keyframes fpFadeInDown/*x*/{from{opacity:0}}@keyframes/*x*/fpFadeInDown{}",
  "keyframes statement":
    "@keyframes fpFadeInDown;.bx--btn{@keyframes fpFadeInDown;a:b}",
  "keyframes statement last": ".bx--btn{@keyframes fpFadeInDown}",
  "charset import": '@charset "utf-8";@import url(x.css);.bx--unused{a:b}',
  "import eof": ".bx--unused{a:b}@import 'x'  \n",
  layer: "@layer a{.bx--unused{a:b}}",
  "at last child no semi": ".bx--btn{@x y }.bx--unused{@x y}",
  "decl forms": ".bx--btn{color:red}.bx--a{color:red;}.bx--b{color:red ; }",
  "decl important":
    ".bx--btn{color:red!important;a:red !IMPORTANT ;b:x ! y important}",
  "custom property": ".bx--btn{--x:{a:b};--y:;--z: ;--w:a:b;c:d}",
  "custom no colon": ".bx--btn{--x{a:b}}",
  "ie hacks": ".bx--btn{*zoom:1}",
  progid: ".bx--btn{filter:progid:DX(a)}",
  "colon in url string paren": '.bx--btn{a:url(c:d);b:"c:d";c:(d:e)}',
  "root decl": "color:red;.bx--unused{a:b}x:y",
  "free semicolons": ".bx--btn{b:c;;}",
  "own semicolon": ".bx--unused{};.bx--btn{}",
  "nesting removed child":
    ".bx--btn{.bx--unused{x:y}}.bx--unused{.bx--btn{x:y}}",
  "nesting semicolon dropped": ".bx--btn{b:c;.bx--unused{x:y}}",
  "nesting semicolon kept":
    ".bx--btn{--x:1;/*k*/.bx--unused{x:y}}.bx--a{b:1;/*k*/.bx--unused{x:y}}",
  "nesting decl after":
    ".bx--btn{.bx--unused{x:y} b:c}.bx--a{@media x{.bx--unused{a:b}}c:d}",
  "nesting all removed": ".bx--btn{.bx--unused{.bx--unused2{c:d}}}",
  "comma lists":
    ".bx--btn,.bx--unused{a:b}.bx--unused,\n.bx--btn\n{a:b}.bx--btn , .bx--unused , button{a:b}",
  "comma edges": ".bx--btn,{a:b},.bx--btn{a:b}.bx--btn,,.bx--unused{a:b}",
  "selector whitespace":
    ".bx--btn  \t{a:b}.bx--unused \n {a:b}.bx--btn\v.bx--unused{a:b}.bx--btn {a:b}",
  "selector escapes":
    ".bx--btn\\:hover{a:b}.bx--unused\\{{a:b}.\\31 0.bx--unused{a:b}.bx--btn\\\\{a:b}",
  legacy: ".bx-btn{a:b}.bx-unused{a:b}",
  flatpickr: ".flatpickr-calendar{a:b}.numInputWrapper:hover{a:b}",
  "context ancestors":
    ".bx--body{a:b}.bx--body--with-modal-open .bx--tooltip{a:b}",
  "empty selector rule": "{}.bx--btn{a:b}",
  "empty rules": ".bx--btn{}.bx--unused{}a{}",
};

describe("css-splice-optimizer", () => {
  for (const [name, source] of Object.entries(HOSTILE)) {
    test(name, () => {
      for (const scenario of Object.values(SCENARIOS)) {
        expectParity(source, scenario);
      }
    });
  }

  test("Carbon theme", () => {
    const source = resolveCarbonCss("white");
    for (const scenario of Object.values(SCENARIOS)) {
      expectParity(source, scenario);
    }
  });

  test("fuzz", () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const pick = <T>(items: T[]) => items[Math.floor(rnd() * items.length)];
    const chance = (p: number) => rnd() < p;

    const WS = ["", "", " ", "\n", "\r\n", "\t", "\f", " \n "];
    const COMMENTS = ["/*c*/", "/**/", "/* IBM Plex */"];
    const SELECTORS = [
      ".bx--btn",
      ".bx--btn--primary",
      ".bx--unused",
      ".bx--accordion__item",
      ".bx--body",
      ".bx--body--with-modal-open .bx--tooltip",
      ".bx--header__global .bx--btn",
      ".bx-btn",
      ".bx-unused",
      ".flatpickr-calendar",
      ".numInputWrapper:hover",
      "button",
      "*",
      ":root",
      "::before",
      "a>b",
      "a+b",
      '[data-x="{"]',
      ".bx--btn:not(.bx--unused)",
      ":is(.bx--btn, .bx--unused)",
      ".bx--btn\\:hover",
      ".\\31 0.bx--btn",
      ".bx--grid",
      "button.bx--btn.bx--btn--primary",
      ".bx--skeleton",
      "from",
      "to",
      ".bx--btn[data-x=url(a'b)]",
      ".bx--btn ",
      "#id.bx--unused",
    ];
    const PROPS = [
      "color",
      "font-family",
      "font-style",
      "font-weight",
      "--x",
      "src",
      "content",
      "*zoom",
    ];
    const VALUES = [
      "red",
      "#fff",
      "IBM Plex Sans",
      "IBM Plex Mono",
      "normal",
      "italic",
      "400",
      "700",
      "'IBM Plex Sans'",
      "url(x.png)",
      "url(data:image/svg+xml;charset=utf8,%3Csvg%3E)",
      'url("x)y")',
      'url(x"y)',
      "url( x)",
      '"}{;"',
      "calc((1px + 2px) * 3)",
      "(a:b)",
      "[c:d]",
      "a:b",
      "",
      " ",
      "!important",
      "red!important",
      "red !important ",
      "x ! y important",
      "b)",
      ")c:d",
      "@b",
      "x /*c*/",
      "{a:b}",
      "IBM Plex Sans ",
    ];
    const AT_NAMES = [
      "media",
      "supports",
      "font-face",
      "keyframes",
      "layer",
      "import",
      "foo",
      "",
    ];
    const AT_PARAMS = [
      "",
      " (min-width:1px)",
      " screen",
      " fpFadeInDown",
      " 'x'",
      " x /*c*/",
      " a /*c*/ b",
      " (a{b)",
    ];

    // Set for a generated construct where the new behavior intentionally
    // diverges from PostCSS (see `BEHAVIOR_CHANGES`); reset per sheet, and
    // used to skip the parity check for that one generated sheet rather
    // than asserting it wrongly matches PostCSS.
    let divergesFromPostcss = false;
    // A non-empty-after-stripping value is never itself an empty value, and
    // custom properties are excluded from PostCSS's empty-value discard rule.
    const EMPTY_VALUES = new Set(["", " ", "!important"]);

    const comment = () => (chance(0.06) ? pick(COMMENTS) : "");
    const decl = () => {
      const prop = pick(PROPS);
      const value = pick(VALUES);
      if (prop !== "--x" && EMPTY_VALUES.has(value)) divergesFromPostcss = true;
      return `${comment()}${pick(WS)}${prop}${pick(WS)}:${pick(WS)}${value}${chance(0.08) ? comment() : ""}`;
    };
    const body = (depth: number): string => {
      const parts: string[] = [];
      const n = Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const r = rnd();
        if (depth > 3 || r < 0.55) {
          parts.push(decl());
          if (chance(0.85) || i < n - 1) parts.push(";");
          if (chance(0.03)) parts.push(";");
        } else if (r < 0.85) {
          parts.push(rule(depth));
        } else {
          parts.push(atrule(depth));
        }
        if (chance(0.05)) parts.push(pick(COMMENTS));
      }
      return parts.join("");
    };
    const rule = (depth: number): string => {
      let sel = pick(SELECTORS);
      if (chance(0.3)) sel += `,${pick(WS)}${pick(SELECTORS)}`;
      if (chance(0.05)) sel += ",";
      if (chance(0.05)) sel = `${sel} ${pick(COMMENTS)} ${pick(SELECTORS)}`;
      return `${comment()}${pick(WS)}${sel}${pick(WS)}${chance(0.05) ? pick(COMMENTS) : ""}{${body(depth + 1)}${pick(WS)}}${chance(0.03) ? ";" : ""}`;
    };
    const atrule = (depth: number): string => {
      const params = pick(AT_PARAMS);
      const name = pick(AT_NAMES);
      // `@layer` de-duplication (an empty layer dropped when an earlier
      // sibling of the same name has content) is not modeled; too
      // stateful across siblings to classify precisely here.
      if (name === "layer") divergesFromPostcss = true;
      const head = `${comment()}${pick(WS)}@${name}${params}${pick(WS)}`;
      if (chance(0.25)) {
        // A paramless at-rule statement (`@foo;`) is kept; PostCSS drops it.
        if (params === "") divergesFromPostcss = true;
        return `${head};`;
      }
      if (chance(0.03)) {
        // No `;`/`{` follows: whatever comes next in the enclosing body
        // keeps accumulating as this at-rule's own params (there is no
        // terminator in between), until it hits a real terminator or EOF.
        // Unpredictable enough that it may end up with genuinely empty
        // params either way; treat it as a possible divergence.
        divergesFromPostcss = true;
        return head;
      }
      return `${head}{${body(depth + 1)}${pick(WS)}}`;
    };
    const sheet = (): string => {
      const parts: string[] = [];
      const n = 1 + Math.floor(rnd() * 6);
      for (let i = 0; i < n; i++) {
        const r = rnd();
        if (r < 0.65) parts.push(rule(0));
        else if (r < 0.9) parts.push(atrule(0));
        else if (r < 0.95) parts.push(`${decl()}${chance(0.7) ? ";" : ""}`);
        else parts.push(pick(COMMENTS));
        if (chance(0.03)) parts.push(";");
        if (chance(0.02)) parts.push("}");
      }
      let css = parts.join(pick(WS)) + pick(WS);
      if (chance(0.02)) {
        // A BOM is left exactly as-is; PostCSS always re-emits `﻿`.
        css = `﻿${css}`;
        divergesFromPostcss = true;
      }
      if (chance(0.02)) {
        // Truncation can land anywhere, including mid at-rule-name with no
        // trailing `;`/`{` — an EOF-terminated paramless at-rule statement,
        // which PostCSS still discards as empty but this scanner now keeps.
        // Too unpredictable to classify precisely; treat any truncation as
        // a possible divergence.
        css = css.slice(0, Math.floor(rnd() * css.length));
        divergesFromPostcss = true;
      }
      return css;
    };

    const scenarios = Object.values(SCENARIOS);
    let matched = 0;
    let postcssErrored = 0;
    for (let i = 0; i < 2000; i++) {
      divergesFromPostcss = false;
      const source = sheet();
      const scenario = pick(scenarios);
      // `spliceOptimizeCss` never bails: it either matches PostCSS, or the
      // input is a known behavior change (skipped here, asserted directly
      // in `BEHAVIOR_CHANGES`/`SYNTAX_ERRORS`) or a genuine syntax error
      // (PostCSS itself throws for it, so there is nothing to compare).
      const actual = spliced(source, scenario);
      const ref = reference(source, scenario);
      if (!ref.ok) {
        postcssErrored++;
        continue;
      }
      if (divergesFromPostcss) continue;
      expect(actual).toEqual(ref);
      matched++;
    }
    // Sanity check that the fuzzer still generates a reasonable mix of
    // valid CSS (matched) and genuine syntax errors (postcssErrored), and
    // that Group A + B fidelity holds up under combination.
    expect(matched).toBeGreaterThan(450);
    expect(postcssErrored).toBeGreaterThan(900);
  });
});

/**
 * Constructs where the new behavior is an intentional divergence from
 * PostCSS (see the file-level comment above), asserted against a
 * hand-written expectation instead of `optimizeCssWithPostcss`.
 */
const BEHAVIOR_CHANGES: Record<
  string,
  [source: string, css: string, removed: number]
> = {
  "sourcemap comment kept as ordinary comment": [
    ".bx--unused{a:b}\n/*# sourceMappingURL=x.css.map */",
    "/*# sourceMappingURL=x.css.map */",
    1,
  ],
  "BOM left exactly as in the source": [
    "﻿.bx--unused{a:b}.bx--btn{c:d}",
    "﻿.bx--btn{c:d}",
    1,
  ],
  "reversed BOM left as-is, not fixed to the correct mark": [
    "￾.bx--unused{a:b}.bx--btn{c:d}",
    "￾.bx--btn{c:d}",
    1,
  ],
  "`<` not escaped": [
    '.bx--btn{content:"</style>"}.bx--unused{a:b}',
    '.bx--btn{content:"</style>"}',
    1,
  ],
  "paramless at-rule statement kept": [
    "@foo;.bx--btn{a:b}",
    "@foo;.bx--btn{a:b}",
    0,
  ],
  "paramless `@font-face;` statement kept": [
    "@font-face;.bx--btn{a:b}",
    "@font-face;.bx--btn{a:b}",
    0,
  ],
  "declaration with an empty value kept": [
    ".bx--btn{color:;a:b}",
    ".bx--btn{color:;a:b}",
    0,
  ],
  "declaration with a whitespace-only value kept": [
    ".bx--btn{a:b;color: }",
    ".bx--btn{a:b;color: }",
    0,
  ],
  "bare `!important` (empty value) kept": [
    ".bx--btn{color:!important;a:b}",
    ".bx--btn{color:!important;a:b}",
    0,
  ],
  "non-empty rule with an empty selector kept": [
    "{color:red}.bx--btn{a:b}",
    "{color:red}.bx--btn{a:b}",
    0,
  ],
  "duplicate empty named @layer kept, not deduplicated": [
    "@layer a{.bx--btn{c:d}}@layer a{.bx--unused{a:b}}",
    "@layer a{.bx--btn{c:d}}@layer a{}",
    1,
  ],
};

describe("css-splice-optimizer behavior changes", () => {
  for (const [name, [source, css, removed]] of Object.entries(
    BEHAVIOR_CHANGES,
  )) {
    test(name, () => {
      expect(spliced(source, SCENARIOS.button)).toEqual({
        ok: true,
        css,
        removed,
      });
    });
  }
});

/**
 * Genuine syntax errors (PostCSS throws `CssSyntaxError` for every one of
 * these): `spliceOptimizeCss` returns the input unchanged with `removed: 0`
 * rather than guessing, the same contract `run()` has for an asset with
 * nothing optimizable.
 */
const SYNTAX_ERRORS: Record<string, string> = {
  "unclosed comment": ".bx--btn{a:b}/*",
  "unclosed string": '.bx--btn{content:"a}',
  "url unclosed": ".bx--btn{background:url(a}",
  "unclosed bracket": ".bx--btn[a{b:c}",
  "at unnamed": "@{}.bx--btn{a:b}",
  "missed semicolon": ".bx--btn{b:c:d}",
  "square colon": ".bx--btn{b:[c:d]}",
  "unknown word": ".bx--btn{b}",
  "backslash eof": ".bx--btn{a:b}\\",
  "close at root": ".bx--btn{a:b}}",
  "unclosed block": ".bx--btn{a:b",
};

describe("css-splice-optimizer syntax errors", () => {
  for (const [name, source] of Object.entries(SYNTAX_ERRORS)) {
    test(name, () => {
      expect(reference(source, SCENARIOS.button).ok).toBe(false);
      for (const scenario of Object.values(SCENARIOS)) {
        expectPassthrough(source, scenario);
      }
    });
  }
});
