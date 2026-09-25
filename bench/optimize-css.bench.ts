import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { group, task } from "ostia";
import {
  createCssOptimizer,
  optimizeCssWithReport,
} from "../src/plugins/create-optimized-css";
import { collectCarbonTokens, scanContent } from "../src/plugins/scan-content";
import { collectCarbonImports } from "../src/plugins/scan-imports";
import { resolveCarbonCss } from "../tests/helpers/carbon-css";
import { components } from "../tests/helpers/component-index";

// Real Carbon theme CSS (~700kb minified), same source the plugin optimizes
// at build time. Any theme works for selector coverage.
const source = resolveCarbonCss("white");

/**
 * Synthetic app CSS with no Carbon classes: the shape of a per-route chunk
 * (utility classes, a media query, a few custom properties). `rules` scales
 * the size; 400 rules is ~25kb.
 */
function appCss(rules: number, prefix = "app"): string {
  let css = ":root{--app-gap:8px;--app-radius:4px}";
  for (let i = 0; i < rules; i++) {
    css += `.${prefix}-card-${i}{display:flex;gap:var(--app-gap);padding:${i % 32}px;border-radius:var(--app-radius);color:#161616}`;
    css += `.${prefix}-card-${i}:hover,.${prefix}-card-${i}:focus-visible{outline:2px solid #0f62fe}`;
    if (i % 8 === 0) {
      css += `@media (min-width:${640 + i}px){.${prefix}-card-${i}{padding:${i % 16}px}}`;
    }
  }
  return css;
}

const APP_CHUNK = appCss(400);
const APP_CHUNK_ROUTE_2 = appCss(120, "route");
const APP_CHUNK_ROUTE_3 = appCss(40, "widget");
// One bundled asset: Carbon theme followed by the app's own styles. Vite
// concatenates imported stylesheets in import order.
const CARBON_PLUS_APP = `${source}\n${APP_CHUNK}`;
// `@layer` (e.g. from Tailwind v4) is modeled like any other at-rule.
const CARBON_PLUS_LAYER = `${source}\n@layer base{${APP_CHUNK}}`;
const SOURCE_BYTES = new TextEncoder().encode(source);

type Scenario = { name: string; ids: string[] };

const SCENARIOS: Scenario[] = [
  { name: "single component (Button)", ids: ["Button"] },
  {
    name: "small bundle (DataTable+Toolbar+OverflowMenu)",
    ids: ["DataTable", "Toolbar", "ToolbarSearch", "OverflowMenu"],
  },
  {
    name: "large bundle (UIShell)",
    ids: ["Header", "SideNav", "SideNavItems", "HeaderGlobalAction"],
  },
];

for (const scenario of SCENARIOS) {
  group(scenario.name, () => {
    task("optimizeCssWithReport", () => {
      optimizeCssWithReport({
        components,
        source,
        ids: scenario.ids,
        silent: true,
      });
    });
  });
}

const BUNDLE_IDS = ["DataTable", "Toolbar", "ToolbarSearch", "OverflowMenu"];
const SAFELIST_REGEXPS = [/^\.bx--btn--/, /bx--tag/];

// Every CSS asset in a build goes through `run`, not just the Carbon theme.
// These cover each branch of that call: the no-Carbon skip, the splice path
// on a mixed asset, the splice path on an asset with `@layer`, and the
// Uint8Array source like Vite emits for CSS assets.
group("per-asset paths (small bundle)", () => {
  const optimizer = createCssOptimizer({
    components,
    ids: BUNDLE_IDS,
    silent: true,
  });

  task("non-Carbon chunk (skip, ~25kb)", () => {
    optimizer.run(APP_CHUNK);
  });

  task("Carbon + app CSS (splice)", () => {
    optimizer.run(CARBON_PLUS_APP);
  });

  task("Carbon + @layer (splice)", () => {
    optimizer.run(CARBON_PLUS_LAYER);
  });

  task("Carbon as Uint8Array", () => {
    optimizer.run(SOURCE_BYTES);
  });
});

// Options that widen the allowlist or add per-selector work.
group("options (small bundle)", () => {
  task("safelist: strings", () => {
    optimizeCssWithReport({
      components,
      source,
      ids: BUNDLE_IDS,
      silent: true,
      safelist: [".bx--grid", ".bx--row", ".bx--col", ".bx--aspect-ratio"],
    });
  });

  task("safelist: RegExp", () => {
    optimizeCssWithReport({
      components,
      source,
      ids: BUNDLE_IDS,
      silent: true,
      safelist: SAFELIST_REGEXPS,
    });
  });

  task("contentClasses: 300 tokens", () => {
    optimizeCssWithReport({
      components,
      source,
      ids: BUNDLE_IDS,
      silent: true,
      contentClasses: CONTENT_CLASSES,
    });
  });

  task("DatePicker (flatpickr kept)", () => {
    optimizeCssWithReport({
      components,
      source,
      ids: [...BUNDLE_IDS, "DatePicker", "DatePickerInput"],
      silent: true,
    });
  });

  task("preserveAllIBMFonts", () => {
    optimizeCssWithReport({
      components,
      source,
      ids: BUNDLE_IDS,
      silent: true,
      preserveAllIBMFonts: true,
    });
  });
});

// A whole `generateBundle`: one optimizer, every CSS asset in the output.
group("full build (small bundle, 4 assets)", () => {
  const assets = [
    ["index.css", CARBON_PLUS_APP],
    ["route-2.css", APP_CHUNK_ROUTE_2],
    ["route-3.css", APP_CHUNK_ROUTE_3],
    ["vendor.css", APP_CHUNK],
  ] as const;

  task("createCssOptimizer + run each asset", () => {
    const optimizer = createCssOptimizer({
      components,
      ids: BUNDLE_IDS,
      silent: true,
    });
    for (const [_id, css] of assets) {
      optimizer.run(css);
    }
  });
});

/**
 * `.bx--*` tokens as `scanContent` would find them in app markup:
 * a few hundred distinct tokens, some of them `-` prefixes.
 */
const CONTENT_CLASSES = Array.from({ length: 300 }, (_, i) =>
  i % 10 === 0 ? `.bx--content-${i}-` : `.bx--content-${i}`,
);

// `content` globs are scanned once per build. 200 source files with a
// handful of Carbon tokens each.
const contentDir = mkdtempSync(join(tmpdir(), "cps-bench-content-"));
for (let i = 0; i < 200; i++) {
  const body = Array.from(
    { length: 40 },
    (_, line) =>
      `<div class="bx--grid bx--row-${line % 7} app-${i}-${line}">${"x".repeat(60)}</div>`,
  ).join("\n");
  writeFileSync(
    join(contentDir, `Page${i}.svelte`),
    `<script>\n  let kind = "primary";\n</script>\n${body}\n<button class={\`bx--btn--\${kind}\`} />\n`,
  );
}

group(
  "content scan",
  () => {
    task("scanContent (200 files)", () => {
      scanContent([join(contentDir, "*.svelte")]);
    });
  },
  {
    after() {
      rmSync(contentDir, { recursive: true, force: true });
    },
  },
);

/**
 * A compiled Svelte 5 component body: ~60 lines of generated JS with the
 * same `bx--` token density per module as the `content scan` fixture above,
 * so the two groups' 200-item medians are comparable.
 */
function compiledModule(i: number): string {
  let body = `import { append, init, insert } from "svelte/internal";\nfunction create_fragment_${i}(ctx) {\n`;
  for (let line = 0; line < 60; line++) {
    body += `  const class_${line} = "bx--grid bx--row-${line % 7} app-${i}-${line}";\n`;
  }
  body += `  const btn_class = \`bx--btn--\${kind}\`;\n  return { class_0, btn_class };\n}\nexport default create_fragment_${i};\n`;
  return body;
}

const MODULES: string[] = Array.from({ length: 200 }, (_, i) =>
  compiledModule(i),
);

const VENDOR_MODULE = Array.from(
  { length: 6500 },
  (_, i) => `function vendorHelper${i}(x){return x*${i}+1;}`,
).join("\n");

group("module scan", () => {
  task("collectCarbonTokens (200 modules, in memory)", () => {
    const classes = new Set<string>();
    for (const source of MODULES) {
      collectCarbonTokens(source, classes);
    }
  });

  task("collectCarbonTokens (300 kB vendor module, fast path)", () => {
    collectCarbonTokens(VENDOR_MODULE, new Set<string>());
  });
});

function importScanMarkup(i: number): string {
  return Array.from(
    { length: 40 },
    (_, line) =>
      `<div class="bx--grid bx--row-${line % 7} app-${i}-${line}">${"x".repeat(60)}</div>`,
  ).join("\n");
}

/** 200 Svelte sources, each with a 6-name barrel import. */
const BARREL_IMPORT_MODULES: string[] = Array.from({ length: 200 }, (_, i) =>
  [
    "<script>",
    '  import { Button, Modal, TextInput, Accordion, DataTable, Toggle } from "carbon-components-svelte";',
    "</script>",
    importScanMarkup(i),
  ].join("\n"),
);

/** The same 200 sources rewritten to direct-path imports. */
const DIRECT_PATH_IMPORT_MODULES: string[] = Array.from(
  { length: 200 },
  (_, i) =>
    [
      "<script>",
      '  import Button from "carbon-components-svelte/src/Button/Button.svelte";',
      '  import Modal from "carbon-components-svelte/src/Modal/Modal.svelte";',
      '  import TextInput from "carbon-components-svelte/src/TextInput/TextInput.svelte";',
      '  import Accordion from "carbon-components-svelte/src/Accordion/Accordion.svelte";',
      '  import DataTable from "carbon-components-svelte/src/DataTable/DataTable.svelte";',
      '  import Toggle from "carbon-components-svelte/src/Toggle/Toggle.svelte";',
      "</script>",
      importScanMarkup(i),
    ].join("\n"),
);

group("import scan", () => {
  task("collectCarbonImports (200 files, barrel imports)", () => {
    const names = new Set<string>();
    for (const source of BARREL_IMPORT_MODULES) {
      collectCarbonImports(source, names);
    }
  });

  task("collectCarbonImports (200 files, direct paths)", () => {
    const names = new Set<string>();
    for (const source of DIRECT_PATH_IMPORT_MODULES) {
      collectCarbonImports(source, names);
    }
  });

  task("collectCarbonImports (300 kB file, fast path)", () => {
    collectCarbonImports(VENDOR_MODULE, new Set<string>());
  });
});
