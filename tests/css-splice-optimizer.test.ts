import { getComponents } from "carbon-preprocess-svelte/component-index-registry";
import { ALWAYS_ON_CLASSES } from "carbon-preprocess-svelte/constants";
import { optimizeCssWithPostcss } from "carbon-preprocess-svelte/plugins/create-optimized-css";
import {
  type SpliceOptimizerOptions,
  spliceOptimizeCss,
} from "carbon-preprocess-svelte/plugins/css-splice-optimizer";
import type { SafelistEntry } from "carbon-preprocess-svelte/plugins/safelist";
import { resolveCarbonCss } from "./helpers/carbon-css";

/**
 * The splice optimizer must produce exactly what the PostCSS pipeline
 * produces for every input it accepts, and must bail (not guess) on every
 * input it does not model. Both are checked here against the PostCSS
 * pipeline as the reference: hand-written hostile inputs cover each
 * construct the scanner special-cases, and a seeded fuzzer covers their
 * combinations.
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

/** `undefined` when the scanner bailed. */
function spliced(source: string, scenario: Scenario): Outcome | undefined {
  const result = spliceOptimizeCss(source, toOptions(scenario));
  return result && { ok: true, ...result };
}

function expectParity(source: string, scenario: Scenario): boolean {
  const actual = spliced(source, scenario);
  if (actual === undefined) return false;
  expect(actual).toEqual(reference(source, scenario));
  return true;
}

const FF = (family: string, style: string, weight: string) =>
  `@font-face{font-family:${family};font-style:${style};font-weight:${weight}}`;

/** `[input, splice path expected to accept it]`. */
const HOSTILE: Record<string, [string, boolean]> = {
  "single kept": [".bx--btn{color:red}", true],
  "single removed": [".bx--unused{color:red}", true],
  "tabs crlf": [
    ".bx--btn\r\n{\r\n\tcolor:red;\r\n}\r\n.bx--unused{x:y}\r\n",
    true,
  ],
  unicode: ['.bx--btn::before{content:"→ ünïcödé"}.bx--ünused{x:y}', true],
  "leading ws inherited by new first node": [
    "\n\n.bx--unused{a:b}\n.bx--btn{c:d}\n",
    true,
  ],
  "leading ws chain": [
    ".bx--u1{}\n.bx--u2{a:b}\n\n.bx--u3{a:b}\n.bx--btn{a:b}\n.bx--u4{a:b}",
    true,
  ],
  "all removed": ["\n.bx--unused{a:b}\n.bx--unused2{c:d}\n\n", true],
  "comment statements": [
    "/* h */\n.bx--btn{/*c*/a:b/*d*/}\n.bx--unused{/*x*/}/* end */",
    true,
  ],
  "comment in selector": [".bx--btn, /*c*/ .bx--unused{a:b}", false],
  "comment trailing selector": [
    ".bx--btn /*c*/ {a:b}.bx--unused/*c*/{a:b}",
    true,
  ],
  "comment in decl": [".bx--btn{a:b /*c*/;c:d}", false],
  "comment after last decl": [".bx--btn{a:b /*c*/}", true],
  "comment after custom decl": [".bx--btn{--x:1 /*c*/}", false],
  "comment around params": [
    "@media /*a*/ screen /*b*/ {.bx--unused{a:b}}",
    true,
  ],
  "comment inside params": [
    "@media screen /*b*/ and (x){.bx--unused{a:b}}",
    false,
  ],
  "sourcemap annotation": [
    ".bx--unused{a:b}\n/*# sourceMappingURL=x.css.map */",
    false,
  ],
  "unclosed comment": [".bx--btn{a:b}/*", false],
  bom: ["﻿.bx--unused{a:b}.bx--btn{c:d}", false],
  "lt escaping": ['.bx--btn{content:"</style>"}.bx--unused{a:b}', false],
  "string braces": ['.bx--btn{content:"}{;"}.bx--unused{content:"{"}', true],
  "string escaped quote": [".bx--btn{content:'a\\'b'}.bx--unused{a:b}", true],
  "unclosed string": ['.bx--btn{content:"a}', false],
  "url data": [
    ".bx--btn{background:url(data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E)}.bx--unused{a:b}",
    true,
  ],
  "url quoted paren": ['.bx--btn{background:url("x)y")}.bx--unused{a:b}', true],
  "url unquoted quote": ['.bx--btn{background:url(x"y)}.bx--unused{a:b}', true],
  "url escaped paren": [
    ".bx--btn{background:url(a\\)b)}.bx--unused{a:b}",
    true,
  ],
  "url word stack": [
    ".bx--btn{background:url x () (y'z)}.bx--unused{a:b}",
    true,
  ],
  "url unclosed": [".bx--btn{background:url(a}", false],
  "bad bracket u2028": ['.bx--btn{a:( "x)}.bx--unused{a:b}', true],
  "attr brace": ['.bx--btn[b="{"]{a:b}.bx--unused[b;c]{a:b}', true],
  "not is": [
    ".bx--btn:not(.bx--unused){a:b}:is(.bx--btn, .bx--unused){a:b}",
    true,
  ],
  "stray close paren": [".bx--btn{a:b)}.bx--unused{a:)b:c}", true],
  "unclosed bracket": [".bx--btn[a{b:c}", false],
  media: [
    "@media (min-width:1px){.bx--unused{a:b}.bx--btn{c:d}}@media x{.bx--unused{a:b}}@media y{}",
    true,
  ],
  "media brace in params": [
    "@media (a{b){.bx--unused{a:b}}.bx--btn{c:d}",
    true,
  ],
  "font-face keep": [
    FF("IBM Plex Sans", "normal", "400") + FF("IBM Plex Mono", "normal", "400"),
    true,
  ],
  "font-face drop": [
    FF("IBM Plex Sans", "italic", "400") + FF("IBM Plex Sans", "normal", "700"),
    true,
  ],
  "font-face other": [
    FF("Comic Sans", "normal", "700") + FF('"IBM Plex Sans"', "normal", "400"),
    true,
  ],
  "font-face spacing": [
    "@font-face{font-family: IBM Plex Sans ;font-style:\tnormal;font-weight:\n400 }",
    true,
  ],
  "font-face important": [
    "@font-face{font-family:IBM Plex Sans;font-style:normal;font-weight:400 !important}",
    false,
  ],
  "font-face upper": [
    "@FONT-FACE{font-family:IBM Plex Sans;font-style:italic;font-weight:400}",
    true,
  ],
  "font-face statement": ["@font-face;.bx--btn{a:b}", false],
  "font-face empty": ["@font-face{}.bx--btn{a:b}", true],
  "font-face nested": [
    "@font-face{font-family:IBM Plex Sans;font-style:normal;font-weight:400;.bx--unused{a:b}}",
    true,
  ],
  "font-face duplicates": [
    "@font-face{font-family:IBM Plex Sans;font-weight:400;font-style:italic;font-style:normal}",
    true,
  ],
  "font-face star hack": [
    "@font-face{*font-family:IBM Plex Sans;font-style:normal;font-weight:700}",
    false,
  ],
  keyframes: [
    "@keyframes fpFadeInDown{from{opacity:0}to{opacity:1}}@keyframes  fpFadeInDown  {}@-webkit-keyframes fpFadeInDown{}",
    true,
  ],
  "keyframes comment": [
    "@keyframes fpFadeInDown/*x*/{from{opacity:0}}@keyframes/*x*/fpFadeInDown{}",
    true,
  ],
  "keyframes statement": [
    "@keyframes fpFadeInDown;.bx--btn{@keyframes fpFadeInDown;a:b}",
    true,
  ],
  "keyframes statement last": [".bx--btn{@keyframes fpFadeInDown}", true],
  "charset import": [
    '@charset "utf-8";@import url(x.css);.bx--unused{a:b}',
    true,
  ],
  "import eof": [".bx--unused{a:b}@import 'x'  \n", true],
  layer: ["@layer a{.bx--unused{a:b}}", false],
  "at empty statement": ["@foo;.bx--btn{a:b}", false],
  "at unnamed": ["@{}.bx--btn{a:b}", false],
  "at last child no semi": [".bx--btn{@x y }.bx--unused{@x y}", true],
  "decl forms": [
    ".bx--btn{color:red}.bx--a{color:red;}.bx--b{color:red ; }",
    true,
  ],
  "decl empty": [".bx--btn{color:;a:b}", false],
  "decl empty ws": [".bx--btn{a:b;color: }", false],
  "decl important": [
    ".bx--btn{color:red!important;a:red !IMPORTANT ;b:x ! y important}",
    true,
  ],
  "decl important only": [".bx--btn{color:!important;a:b}", false],
  "custom property": [".bx--btn{--x:{a:b};--y:;--z: ;--w:a:b;c:d}", true],
  "custom no colon": [".bx--btn{--x{a:b}}", true],
  "ie hacks": [".bx--btn{*zoom:1}", false],
  "missed semicolon": [".bx--btn{b:c:d}", false],
  progid: [".bx--btn{filter:progid:DX(a)}", false],
  "square colon": [".bx--btn{b:[c:d]}", false],
  "colon in url string paren": ['.bx--btn{a:url(c:d);b:"c:d";c:(d:e)}', true],
  "unknown word": [".bx--btn{b}", false],
  "root decl": ["color:red;.bx--unused{a:b}x:y", true],
  "free semicolons": [".bx--btn{b:c;;}", false],
  "own semicolon": [".bx--unused{};.bx--btn{}", false],
  "nesting removed child": [
    ".bx--btn{.bx--unused{x:y}}.bx--unused{.bx--btn{x:y}}",
    true,
  ],
  "nesting semicolon dropped": [".bx--btn{b:c;.bx--unused{x:y}}", true],
  "nesting semicolon kept": [
    ".bx--btn{--x:1;/*k*/.bx--unused{x:y}}.bx--a{b:1;/*k*/.bx--unused{x:y}}",
    true,
  ],
  "nesting decl after": [
    ".bx--btn{.bx--unused{x:y} b:c}.bx--a{@media x{.bx--unused{a:b}}c:d}",
    true,
  ],
  "nesting all removed": [".bx--btn{.bx--unused{.bx--unused2{c:d}}}", true],
  "comma lists": [
    ".bx--btn,.bx--unused{a:b}.bx--unused,\n.bx--btn\n{a:b}.bx--btn , .bx--unused , button{a:b}",
    true,
  ],
  "comma edges": [
    ".bx--btn,{a:b},.bx--btn{a:b}.bx--btn,,.bx--unused{a:b}",
    true,
  ],
  "selector whitespace": [
    ".bx--btn  \t{a:b}.bx--unused \n {a:b}.bx--btn\v.bx--unused{a:b}.bx--btn {a:b}",
    true,
  ],
  "selector escapes": [
    ".bx--btn\\:hover{a:b}.bx--unused\\{{a:b}.\\31 0.bx--unused{a:b}.bx--btn\\\\{a:b}",
    true,
  ],
  "backslash eof": [".bx--btn{a:b}\\", false],
  legacy: [".bx-btn{a:b}.bx-unused{a:b}", true],
  flatpickr: [".flatpickr-calendar{a:b}.numInputWrapper:hover{a:b}", true],
  "context ancestors": [
    ".bx--body{a:b}.bx--body--with-modal-open .bx--tooltip{a:b}",
    true,
  ],
  "close at root": [".bx--btn{a:b}}", false],
  "unclosed block": [".bx--btn{a:b", false],
  "empty selector rule": ["{}.bx--btn{a:b}", false],
  "empty rules": [".bx--btn{}.bx--unused{}a{}", true],
};

describe("css-splice-optimizer", () => {
  for (const [name, [source, accepted]] of Object.entries(HOSTILE)) {
    test(name, () => {
      for (const scenario of Object.values(SCENARIOS)) {
        expect(expectParity(source, scenario)).toBe(accepted);
      }
    });
  }

  test("Carbon theme", () => {
    const source = resolveCarbonCss("white");
    for (const scenario of Object.values(SCENARIOS)) {
      expect(expectParity(source, scenario)).toBe(true);
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

    const comment = () => (chance(0.06) ? pick(COMMENTS) : "");
    const decl = () =>
      `${comment()}${pick(WS)}${pick(PROPS)}${pick(WS)}:${pick(WS)}${pick(VALUES)}${chance(0.08) ? comment() : ""}`;
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
      const head = `${comment()}${pick(WS)}@${pick(AT_NAMES)}${pick(AT_PARAMS)}${pick(WS)}`;
      if (chance(0.25)) return `${head};`;
      if (chance(0.03)) return head;
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
      if (chance(0.02)) css = `﻿${css}`;
      if (chance(0.02)) css = css.slice(0, Math.floor(rnd() * css.length));
      return css;
    };

    const scenarios = Object.values(SCENARIOS);
    let accepted = 0;
    for (let i = 0; i < 2000; i++) {
      if (expectParity(sheet(), pick(scenarios))) accepted++;
    }
    // Sanity check that the fuzzer exercises the splice path, not just bails.
    expect(accepted).toBeGreaterThan(100);
  });
});
