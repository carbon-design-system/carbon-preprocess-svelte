import { readFileSync } from "node:fs";
import path from "node:path";
import { group, task } from "ostia";
import { analyzeFiles, specializeFiles } from "../src/analyzer";
import { collectAppUsage } from "../src/analyzer/app-usage";
import { readCarbonComponents } from "../src/analyzer/call-sites";
import { buildComponentModel } from "../src/analyzer/component-model";
import { toSourceMap } from "../src/analyzer/mapped-text";
import { specializeComponent } from "../src/analyzer/specialize";
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
  // The vite-matrix example as of its first benchmark (UI shell, forms,
  // list boxes, DataTable, Modal), frozen so edits to the example don't
  // move the numbers.
  "large (vite-matrix app)": readFileSync(
    path.join(import.meta.dirname, "fixtures/vite-matrix-app.svelte"),
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

// The same app as its real files: `App.svelte` renders the `ActionButton`
// wrapper, so the app components' own fixpoint and the wrapper's props
// run too.
const matrixSrc = path.join(import.meta.dirname, "fixtures/wrapper");
const matrixFiles = ["App.svelte", "ActionButton.svelte"].map((name) => ({
  file: path.join(matrixSrc, name),
  code: readFileSync(path.join(matrixSrc, name), "utf8"),
}));

group("prop-aware: large app with its wrapper (2 files)", () => {
  task("analyzeFiles", async () => {
    await analyzeFiles({
      projectRoot: root,
      files: matrixFiles,
      components: large.components,
      options: {},
    });
  });
  task("specializeFiles", async () => {
    await specializeFiles({ projectRoot: root, files: matrixFiles });
  });
});

// The app components' fixpoint at bundle scale: what the prop-aware CSS
// plugin reads every build now that it sees every module. 40 `.svelte`
// files that wrap Carbon and each other, 400 scripts (a tenth of them
// importing Carbon), and a 300 kB vendor module.
const carbon = readCarbonComponents(resolveCarbonRoot(root));
const bundleDir = path.join(root, "bench-app/src");
const bundleModules = [
  ...Array.from({ length: 40 }, (_, i) => ({
    file: path.join(bundleDir, `Card${i}.svelte`),
    code: `<script>
  import { Button, Tag } from "carbon-components-svelte";
  ${i > 0 ? `import Inner from "./Card${i - 1}.svelte";` : ""}
  export let tone = "primary";
  const label = "Card ${i}";
</script>
<Tag type="blue">{label}</Tag>
<Button kind={tone === "danger" ? "danger" : "ghost"}><slot /></Button>
${i > 0 ? `<Inner tone="danger">{label}</Inner>` : ""}`,
  })),
  {
    file: path.join(bundleDir, "main.js"),
    code: `import App from "./Card39.svelte";\nnew App({ target: document.body });`,
  },
  ...Array.from({ length: 400 }, (_, i) => ({
    file: path.join(bundleDir, `lib/module${i}.js`),
    code:
      i % 10 === 0
        ? `import { Modal } from "carbon-components-svelte";\nexport const dialog${i} = Modal;`
        : `export function helper${i}(value) {\n  return String(value).padStart(${i % 7}, "0");\n}\n`.repeat(
            8,
          ),
  })),
  {
    file: path.join(root, "node_modules/vendor/index.js"),
    code: "export const vendor = () => 'x';\n".repeat(10_000),
  },
];

group(`collectAppUsage over ${bundleModules.length} modules`, () => {
  task("collectAppUsage", () => {
    collectAppUsage(bundleModules, carbon);
  });
});

// Source maps for the largest component the large app rewrites.
const largest = [...largeResult.analysis.liveComponents]
  .map((key) => ({ key, scope: largeResult.analysis.scopeFor(key) }))
  .filter((entry) => entry.scope !== undefined)
  .map((entry) => ({ ...entry, code: entry.scope?.model.code ?? "" }))
  .sort((a, b) => b.code.length - a.code.length)[0];
const largestScope = largest.scope;
if (!largestScope) throw new Error("no rewritten component");
const largestSpecialized = specializeComponent(largestScope);

// `/` separates a group from its tasks in ostia's names.
group(`source map: ${path.posix.parse(largest.key).name}`, () => {
  task("specializeComponent", () => {
    specializeComponent(largestScope);
  });
  task("toSourceMap", () => {
    toSourceMap(largestSpecialized.mapped, largest.code, largest.key);
  });
});
