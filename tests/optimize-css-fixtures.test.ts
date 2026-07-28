import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createOptimizedCss } from "carbon-preprocess-svelte/plugins/create-optimized-css";
import postcss from "postcss";
import {
  buildAllowlist,
  carbonClassesIn,
  matchesAllowlist,
  prettifyCss,
  resolveCarbonCss,
  shouldKeepStrictSelector,
} from "./helpers/carbon-css";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures/optimize-css");
const UPDATE_FIXTURES = process.env.UPDATE_FIXTURES === "true";
const THEME = "white";

type Scenario = {
  /** Fixture base name, e.g. "button.strict". */
  name: string;
  /** Component ids to treat as imported (drives the allowlist). */
  ids: string[];
};

const SCENARIOS: Scenario[] = [
  { name: "button.strict", ids: ["Button"] },
  { name: "datatable.strict", ids: ["DataTable"] },
  { name: "button-accordion.strict", ids: ["Button", "Accordion"] },
  // DatePicker ships with Flatpickr CSS; import DatePickerInput too (typical usage).
  { name: "datepicker.strict", ids: ["DatePicker", "DatePickerInput"] },
  // Modal adds `.bx--body--with-modal-open` on `<body>` at runtime. Keep that
  // rule; drop descendant rules for tooltip/overflow-menu (Modal does not import them).
  { name: "modal.strict", ids: ["Modal"] },
  // Zero-leak gold standard — well-indexed single components.
  { name: "dropdown.strict", ids: ["Dropdown"] },
  { name: "combobox.strict", ids: ["ComboBox"] },
  { name: "overflowmenu.strict", ids: ["OverflowMenu"] },
  { name: "search.strict", ids: ["Search"] },
  { name: "select.strict", ids: ["Select"] },
  // Select `inline` styles live under Pagination descendants in Carbon CSS.
  { name: "select-pagination.strict", ids: ["Select", "Pagination"] },
  { name: "checkbox.strict", ids: ["Checkbox"] },
  { name: "slider.strict", ids: ["Slider"] },
  { name: "breadcrumb.strict", ids: ["Breadcrumb"] },
  { name: "textinput.strict", ids: ["TextInput"] },
  { name: "fluid-form.strict", ids: ["TextInput", "FluidForm"] },
  { name: "toggle.strict", ids: ["Toggle"] },
  { name: "numberinput.strict", ids: ["NumberInput"] },
  // Multi-import bundles — import sets users actually ship.
  {
    name: "dropdown-skeleton.strict",
    ids: ["Dropdown", "DropdownSkeleton"],
  },
  { name: "tabs-bundle.strict", ids: ["Tabs", "Tab", "TabContent"] },
  {
    name: "datatable-overflowmenu.strict",
    ids: ["DataTable", "OverflowMenu", "Link"],
  },
  {
    name: "accordion-bundle.strict",
    ids: ["Accordion", "AccordionItem"],
  },
  {
    name: "composed-modal-bundle.strict",
    ids: ["ComposedModal", "ModalHeader", "ModalBody", "ModalFooter"],
  },
  {
    name: "timepicker-bundle.strict",
    ids: ["TimePicker", "TimePickerSelect"],
  },
  // Leaky regression baselines — compound-selector piggybacking.
  { name: "tabs.strict", ids: ["Tabs"] },
  { name: "sidenav.strict", ids: ["SideNav"] },
  { name: "header.strict", ids: ["Header"] },
  { name: "header-global-action.strict", ids: ["HeaderGlobalAction"] },
  {
    name: "uishell.strict",
    ids: ["Header", "SideNav", "SideNavItems"],
  },
  { name: "tooltip.strict", ids: ["Tooltip"] },
  {
    name: "datatable-toolbar.strict",
    ids: ["DataTable", "Toolbar", "ToolbarSearch"],
  },
  { name: "multiselect.strict", ids: ["MultiSelect"] },
  { name: "passwordinput.strict", ids: ["PasswordInput"] },
  {
    name: "fileuploader-bundle.strict",
    ids: ["FileUploader", "FileUploaderButton", "FileUploaderItem"],
  },
  { name: "inline-notification.strict", ids: ["InlineNotification"] },
];

type Report = {
  ids: string[];
  before_bytes: number;
  after_bytes: number;
  reduction_percent: number;
  kept_rules: number;
  leaked_count: number;
  /** Carbon classes that survived but the allowlist does not justify. */
  leaked_classes: string[];
};

/** Split a selector list on top-level commas (parenthesis-aware), like the source. */
function splitSelectorList(selector: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      selectors.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  selectors.push(selector.slice(start).trim());

  return selectors.filter(Boolean);
}

/** Every individual selector (parenthesis-aware) across all rules in the CSS. */
function selectorsOf(css: string): string[] {
  const out: string[] = [];
  postcss.parse(css).walkRules((rule) => {
    out.push(...splitSelectorList(rule.selector));
  });
  return out;
}

function ruleCount(css: string): number {
  let count = 0;
  postcss.parse(css).walkRules(() => {
    count++;
  });
  return count;
}

/** Unique Carbon classes referenced anywhere in the CSS. */
function carbonClassesOf(css: string): Set<string> {
  const classes = new Set<string>();
  for (const selector of selectorsOf(css)) {
    for (const cls of carbonClassesIn(selector)) classes.add(cls);
  }
  return classes;
}

function readFixture(file: string): string | null {
  const path = join(FIXTURES_DIR, file);
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

function writeFixture(file: string, content: string): void {
  if (!existsSync(FIXTURES_DIR)) mkdirSync(FIXTURES_DIR, { recursive: true });
  writeFileSync(join(FIXTURES_DIR, file), content);
}

const source = resolveCarbonCss(THEME);

for (const scenario of SCENARIOS) {
  describe(`optimize-css fixtures: ${scenario.name}`, () => {
    const output = createOptimizedCss({
      source,
      ids: scenario.ids,
    });
    const allowlist = buildAllowlist(scenario.ids);
    const outputClasses = carbonClassesOf(output);

    const leakedClasses = [...outputClasses]
      .filter((cls) => !matchesAllowlist(cls, allowlist))
      .sort();

    const beforeBytes = Buffer.byteLength(source);
    const afterBytes = Buffer.byteLength(output);
    const report: Report = {
      ids: scenario.ids,
      before_bytes: beforeBytes,
      after_bytes: afterBytes,
      reduction_percent: Number(
        (((beforeBytes - afterBytes) / beforeBytes) * 100).toFixed(2),
      ),
      kept_rules: ruleCount(output),
      leaked_count: leakedClasses.length,
      leaked_classes: leakedClasses,
    };

    // Pretty CSS for local inspection (.gitignore). Baseline is .report.json.
    writeFixture(`${scenario.name}.css`, prettifyCss(output));

    if (UPDATE_FIXTURES) {
      writeFixture(
        `${scenario.name}.report.json`,
        `${JSON.stringify(report, null, 2)}\n`,
      );
    }

    test("matches the committed leak report", () => {
      const expected = readFixture(`${scenario.name}.report.json`);
      if (expected === null) {
        throw new Error(
          `Missing fixture ${scenario.name}.report.json. Run \`bun run test:fixtures:update\`.`,
        );
      }
      expect(`${JSON.stringify(report, null, 2)}\n`).toBe(expected);
    });

    // Every Carbon class in a fully-allowed source selector must appear in output.
    // Scope to selectors where all classes match the allowlist, so we do not flag
    // classes pruned because a co-occurring foreign class was dropped (e.g.
    // DatePicker range rules that mention DatePickerInput).
    test("does not over-prune self-justified selectors", () => {
      const expectedSurvive = new Set<string>();

      for (const selector of selectorsOf(source)) {
        const classes = carbonClassesIn(selector);
        if (classes.length === 0) continue;
        if (shouldKeepStrictSelector(selector, allowlist)) {
          for (const cls of classes) expectedSurvive.add(cls);
        }
      }

      const missing = [...expectedSurvive]
        .filter((cls) => !outputClasses.has(cls))
        .sort();

      expect(missing).toEqual([]);
    });

    if (scenario.name === "modal.strict") {
      // Scroll-lock rule stays; tooltip/overflow descendants go.
      test("keeps modal scroll-lock but drops its foreign descendants", () => {
        expect(output).toContain(".bx--body--with-modal-open{");
        expect(output).not.toContain(".bx--body--with-modal-open .bx--tooltip");
        expect(output).not.toContain(".bx--overflow-menu-options");
      });
    }

    if (scenario.name === "sidenav.strict") {
      // SideNav toggles `.bx--body--with-modal-open` via bodyScrollLock (overlay).
      test("keeps sidenav scroll-lock but drops its foreign descendants", () => {
        expect(output).toContain(".bx--body--with-modal-open{");
        expect(output).not.toContain(".bx--body--with-modal-open .bx--tooltip");
      });
    }

    if (scenario.name === "uishell.strict") {
      test("keeps core UIShell selectors", () => {
        expect(output).toContain(".bx--side-nav");
        expect(output).toContain(".bx--header");
      });
    }

    if (scenario.name === "header-global-action.strict") {
      test("keeps header global button hover styles for icon fill", () => {
        expect(output).toContain(
          ".bx--header__global button.bx--header__action.bx--header__action:not(.bx--header-search-button)",
        );
        expect(output).toContain(
          ".bx--header__action.bx--header__action:hover>svg",
        );
      });
    }

    if (scenario.name === "tabs-bundle.strict") {
      test("keeps typical tabs page selectors", () => {
        expect(output).toContain(".bx--tabs__nav-link");
        expect(output).toContain(".bx--tab-content");
      });
    }

    if (scenario.name === "select-pagination.strict") {
      test("keeps inline select wrapper styles under pagination", () => {
        expect(output).toContain(".bx--select-input--inline__wrapper");
      });
    }

    if (scenario.name === "accordion-bundle.strict") {
      test("keeps typical accordion page selectors", () => {
        expect(output).toContain(".bx--accordion__item");
      });
    }

    if (scenario.name === "composed-modal-bundle.strict") {
      test("keeps composed modal shell selectors", () => {
        expect(output).toContain(".bx--modal-header");
        expect(output).toContain(".bx--modal-content");
      });
    }

    if (scenario.name === "timepicker-bundle.strict") {
      test("keeps time picker child select selectors", () => {
        expect(output).toContain(".bx--time-picker__select");
      });
    }

    if (scenario.name === "textinput.strict") {
      test("drops fluid form ancestor selectors", () => {
        expect(output).not.toContain(".bx--form--fluid .bx--text-input");
      });
    }

    if (scenario.name === "fluid-form.strict") {
      test("keeps fluid form ancestor selectors", () => {
        expect(output).toContain(".bx--form--fluid .bx--text-input");
      });
    }

    if (scenario.name === "numberinput.strict") {
      test("drops modal context selectors", () => {
        expect(output).not.toContain(".bx--modal .bx--number");
      });
    }

    if (scenario.name === "multiselect.strict") {
      test("keeps list-box core selectors", () => {
        expect(output).toContain(".bx--list-box");
      });
    }

    test("keeps no selector that is entirely foreign Carbon classes", () => {
      const offenders = selectorsOf(output).filter((selector) => {
        const classes = carbonClassesIn(selector);
        return (
          classes.length > 0 && !shouldKeepStrictSelector(selector, allowlist)
        );
      });

      expect(offenders).toEqual([]);
    });
  });
}
