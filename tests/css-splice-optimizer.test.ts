import { ALWAYS_ON_CLASSES } from "carbon-preprocess-svelte/constants";
import {
  type SpliceOptimizerOptions,
  spliceOptimizeCss,
} from "carbon-preprocess-svelte/plugins/css-splice-optimizer";
import type { SafelistEntry } from "carbon-preprocess-svelte/plugins/safelist";
import { resolveCarbonCss } from "./helpers/carbon-css";
import { components } from "./helpers/component-index";

/**
 * `spliceOptimizeCss` never bails outright. A syntax error, or a construct
 * too ambiguous to classify, returns the input unchanged with `removed: 0`,
 * the same contract `run()` has for an asset with nothing optimizable.
 * Those cases are asserted directly in `describe("syntax errors", ...)`.
 * Constructs caligula deliberately keeps as-is are asserted in
 * `describe("behavior changes", ...)`.
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
  text: { ids: ["Text"] },
  safelist: { ids: ["Accordion"], safelist: [".bx--grid", /^\.bx--btn--/] },
  // Stateful regexes make the visitor call sequence observable.
  safelistGlobal: { ids: ["Accordion"], safelist: [/bx--btn/g] },
};

function toOptions(scenario: Scenario): SpliceOptimizerOptions {
  const allowlist = new Set(ALWAYS_ON_CLASSES);
  for (const id of scenario.ids) {
    for (const cls of components[id]?.classes ?? []) allowlist.add(cls);
  }
  return {
    allowlist,
    components,
    preserveAllIBMFonts: scenario.preserveAllIBMFonts === true,
    preserveFlatpickr: scenario.ids.includes("DatePicker"),
    // Fresh RegExp instances so `lastIndex` starts equal for both runs.
    safelist: (scenario.safelist ?? []).map((entry) =>
      typeof entry === "string" ? entry : new RegExp(entry.source, entry.flags),
    ),
  };
}

function spliced(source: string, scenario: Scenario) {
  return spliceOptimizeCss(source, toOptions(scenario));
}

/** A full, byte-for-byte passthrough: `spliceOptimizeCss`'s bail contract. */
function expectPassthrough(source: string, scenario: Scenario): void {
  expect(spliced(source, scenario)).toEqual({ css: source, removed: 0 });
}

describe("css-splice-optimizer", () => {
  test("Carbon theme", () => {
    const source = resolveCarbonCss("white");
    for (const scenario of Object.values(SCENARIOS)) {
      const { css, removed } = spliced(source, scenario);
      expect(removed).toBeGreaterThan(0);
      expect(css.length).toBeLessThan(source.length);
    }
  });
});

/** Constructs kept or left exactly as written, asserted against hand-written expectations. */
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
      expect(spliced(source, SCENARIOS.button)).toEqual({ css, removed });
    });
  }
});

/**
 * These are genuine syntax errors. `spliceOptimizeCss` returns the input
 * unchanged with `removed: 0` and does not guess.
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
      for (const scenario of Object.values(SCENARIOS)) {
        expectPassthrough(source, scenario);
      }
    });
  }
});
