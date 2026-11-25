import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeFiles } from "svelte-prune/internal/analysis";
import { CARBON, CSS_FAILURE } from "../src/carbon-library";
import { resolveCarbonRoot } from "../src/indexer/resolve-carbon-root";
import { bundledStylesheets } from "../src/plugins/carbon-style-pruner";
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
});
