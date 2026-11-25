import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { optimizeCarbonCss } from "carbon-preprocess-svelte";
import { analyzeFiles } from "svelte-prune/internal/analysis";
import { CARBON, CSS_FAILURE } from "../src/carbon-library";
import { resolveCarbonRoot } from "../src/indexer/resolve-carbon-root";
import {
  bundledStylesheets,
  collectCarbonStylesheets,
} from "../src/plugins/carbon-style-pruner";
import {
  collectedEngine,
  cssUsage,
  optimizeCssWithReport,
} from "../src/plugins/create-optimized-css";

describe("bundledStylesheets", () => {
  test("names the Carbon stylesheets among module ids, and nothing else", () => {
    expect(
      bundledStylesheets([
        "/app/node_modules/carbon-components-svelte/css/white.css",
        "C:\\app\\node_modules\\carbon-components-svelte\\css\\prose.css?inline",
        "/app/node_modules/carbon-components-svelte/css/white.css",
        "/app/node_modules/carbon-components-svelte/src/Button/Button.svelte",
        "/app/src/app.css",
        "/app/node_modules/other/css/white.css",
      ]),
    ).toEqual([
      "carbon-components-svelte/css/prose.css",
      "carbon-components-svelte/css/white.css",
    ]);
  });
});

test("pruning only the bundled stylesheet gives the same CSS as reading all of them", async () => {
  const analyzer = await import("svelte-prune/internal/analysis");
  const root = process.cwd();
  const result = await analyzeFiles({
    library: CARBON,
    failure: CSS_FAILURE,
    projectRoot: root,
    files: [
      {
        file: join(root, "App.svelte"),
        code: '<script>\n  import { Button, DataTable } from "carbon-components-svelte";\n</script>\n<Button kind="tertiary">Save</Button>\n<DataTable />\n',
      },
    ],
    components: ["Button", "DataTable"],
    options: {},
  });
  if ("warning" in result) throw new Error(result.warning);
  const source = readFileSync(
    join(resolveCarbonRoot(), "css", "white.css"),
    "utf8",
  );
  const prune = (stylesheets?: string[]) =>
    optimizeCssWithReport({
      source,
      analysis: cssUsage(result, analyzer),
      engine: {
        ...collectedEngine(result, analyzer, root, []),
        stylesheets,
      },
    });

  const all = prune();
  expect(all.removed).toBeGreaterThan(0);
  expect(prune(["carbon-components-svelte/css/white.css"])).toEqual(all);
  // A name the installed Carbon doesn't ship, as a comment or another
  // install can give, is left out rather than failing the build.
  expect(prune(["carbon-components-svelte/css/missing.css"])).toEqual(all);
  expect(
    prune([
      "carbon-components-svelte/css/missing.css",
      "carbon-components-svelte/css/white.css",
    ]),
  ).toEqual(all);
});

describe("collectCarbonStylesheets", () => {
  test("finds the Carbon stylesheets code imports, in any form", () => {
    const found = new Set<string>();
    for (const code of [
      'import "carbon-components-svelte/css/white.css";',
      '<style>@import "carbon-components-svelte/css/g100.css";</style>',
      '@import "~carbon-components-svelte/css/prose.css";',
      '<link rel="stylesheet" href="/node_modules/carbon-components-svelte/css/white.css" />',
      'import { Button } from "carbon-components-svelte";',
    ]) {
      collectCarbonStylesheets(code, found);
    }
    expect([...found].sort()).toEqual([
      "carbon-components-svelte/css/g100.css",
      "carbon-components-svelte/css/prose.css",
      "carbon-components-svelte/css/white.css",
    ]);
  });
});

test("optimizeCarbonCss prunes the same when the app's files name its stylesheet", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cps-stylesheets-"));
  try {
    mkdirSync(join(dir, "src"));
    const app =
      '<script>\n  import { Button } from "carbon-components-svelte";\n</script>\n<Button kind="tertiary">Save</Button>\n';
    writeFileSync(join(dir, "src", "App.svelte"), app);
    const css = readFileSync(
      join(resolveCarbonRoot(), "css", "white.css"),
      "utf8",
    );
    const options = { components: ["Button"], content: ["src/**/*"], cwd: dir };
    const all = await optimizeCarbonCss(css, options);

    writeFileSync(
      join(dir, "src", "main.js"),
      'import "carbon-components-svelte/css/white.css";\n',
    );
    expect(await optimizeCarbonCss(css, options)).toEqual(all);
    expect(all.removed).toBeGreaterThan(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
