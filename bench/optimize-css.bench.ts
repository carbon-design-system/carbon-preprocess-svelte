import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { group, task } from "ostia";
import {
  createCssOptimizer,
  optimizeCssWithReport,
} from "../src/plugins/create-optimized-css";
import { scanContentClasses } from "../src/plugins/scan-content";
import { resolveCarbonCss } from "../tests/helpers/carbon-css";

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
// raw-bytes input Vite hands over for emitted assets.
group("per-asset paths (small bundle)", () => {
  const optimizer = createCssOptimizer({ ids: BUNDLE_IDS, silent: true });

  task("non-Carbon chunk (skip, ~25kb)", () => {
    optimizer.run(APP_CHUNK, "chunk.css");
  });

  task("Carbon + app CSS (splice)", () => {
    optimizer.run(CARBON_PLUS_APP, "index.css");
  });

  task("Carbon + @layer (splice)", () => {
    optimizer.run(CARBON_PLUS_LAYER, "index.css");
  });

  task("Carbon as Uint8Array", () => {
    optimizer.run(SOURCE_BYTES, "index.css");
  });
});

// Options that widen the allowlist or add per-selector work.
group("options (small bundle)", () => {
  task("safelist: strings", () => {
    optimizeCssWithReport({
      source,
      ids: BUNDLE_IDS,
      silent: true,
      safelist: [".bx--grid", ".bx--row", ".bx--col", ".bx--aspect-ratio"],
    });
  });

  task("safelist: RegExp", () => {
    optimizeCssWithReport({
      source,
      ids: BUNDLE_IDS,
      silent: true,
      safelist: SAFELIST_REGEXPS,
    });
  });

  task("contentClasses: 300 tokens", () => {
    optimizeCssWithReport({
      source,
      ids: BUNDLE_IDS,
      silent: true,
      contentClasses: CONTENT_CLASSES,
    });
  });

  task("DatePicker (flatpickr kept)", () => {
    optimizeCssWithReport({
      source,
      ids: [...BUNDLE_IDS, "DatePicker", "DatePickerInput"],
      silent: true,
    });
  });

  task("preserveAllIBMFonts", () => {
    optimizeCssWithReport({
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
    const optimizer = createCssOptimizer({ ids: BUNDLE_IDS, silent: true });
    for (const [id, css] of assets) {
      optimizer.run(css, id);
    }
  });
});

/**
 * `.bx--*` tokens as `scanContentClasses` would find them in app markup:
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
    task("scanContentClasses (200 files)", () => {
      scanContentClasses([join(contentDir, "*.svelte")]);
    });
  },
  {
    after() {
      rmSync(contentDir, { recursive: true, force: true });
    },
  },
);
