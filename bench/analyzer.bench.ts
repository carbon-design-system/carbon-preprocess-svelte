import { readFileSync } from "node:fs";
import path from "node:path";
import { group, task } from "ostia";
import { analyzeFiles, specializeFiles } from "../src/analyzer";
import { buildComponentModel } from "../src/analyzer/component-model";
import { resolveCarbonRoot } from "../src/indexer/resolve-carbon-root";
import { optimizeCssWithReport } from "../src/plugins/create-optimized-css";
import { collectCarbonImports } from "../src/plugins/scan-imports";
import { resolveCarbonCss } from "../tests/helpers/carbon-css";
import { components } from "../tests/helpers/component-index";

const root = path.join(import.meta.dirname, "..");
const carbonSrc = path.join(resolveCarbonRoot(root), "src");
const css = resolveCarbonCss("white");

/** Apps of growing size, as the `content` a build would analyze. */
const APPS = {
  "small (one Button)": `<script>import { Button } from "carbon-components-svelte";</script>
<Button kind="tertiary">Save</Button>`,
  "medium (form + modal)": `<script>
  import { Button, Checkbox, Form, InlineNotification, Modal, Select, SelectItem, Tag, TextInput, Toggle } from "carbon-components-svelte";
  let open = false;
</script>
<InlineNotification kind="error" title="Error" subtitle="Something broke" />
<Form>
  <TextInput labelText="Name" />
  <Select labelText="Region"><SelectItem value="us" text="US" /></Select>
  <Checkbox labelText="Subscribe" />
  <Toggle labelText="Notifications" />
  <Tag type="blue">Beta</Tag>
  <Button type="submit">Save</Button>
</Form>
<Modal bind:open modalHeading="Confirm" primaryButtonText="OK">Sure?</Modal>`,
  // The vite-matrix example: UI shell, forms, list boxes, DataTable, Modal.
  "large (vite-matrix app)": readFileSync(
    path.join(root, "examples/vite-matrix@svelte-5/src/App.svelte"),
    "utf8",
  ),
};

type App = { file: string; code: string; components: string[] };

const apps = Object.entries(APPS).map(([name, code]): [string, App] => {
  const imported = new Set<string>();
  collectCarbonImports(code, imported);
  return [
    name,
    { file: path.join(root, "App.svelte"), code, components: [...imported] },
  ];
});

const analyze = (app: App) =>
  analyzeFiles({
    projectRoot: root,
    files: [{ file: app.file, code: app.code }],
    components: app.components,
    options: {},
  });

// Component models are cached by path and mtime, so after the first build
// these measure the analysis itself, as on a `vite build --watch` rebuild.
for (const [name, app] of apps) {
  group(`prop-aware: ${name}`, () => {
    task("analyzeFiles", async () => {
      await analyze(app);
    });
    task("specializeFiles", async () => {
      await specializeFiles({
        projectRoot: root,
        files: [{ file: app.file, code: app.code }],
      });
    });
  });
}

// What a cold build adds: parsing and modeling every component an app
// renders (the large app renders about 90).
const large = apps[apps.length - 1][1];
const largeResult = await analyze(large);
if ("warning" in largeResult) throw new Error(largeResult.warning);
const liveSources = [...largeResult.analysis.liveComponents].map((key) => ({
  key,
  code: readFileSync(path.join(carbonSrc, key), "utf8"),
}));

group("cold: model every component the large app renders", () => {
  task(`buildComponentModel × ${liveSources.length}`, () => {
    for (const { key, code } of liveSources) buildComponentModel(code, key);
  });
});

// The CSS pass the analysis feeds: the same stylesheet and bundle, with and
// without prop-aware pruning.
group("optimizeCss on white.css (large app)", () => {
  const ids = [...largeResult.analysis.liveComponents].map(
    (key) => path.posix.parse(key).name,
  );
  task("without propAware", () => {
    optimizeCssWithReport({ source: css, components, ids });
  });
  task("with propAware", () => {
    optimizeCssWithReport({
      source: css,
      components,
      ids,
      propAware: largeResult,
    });
  });
});
