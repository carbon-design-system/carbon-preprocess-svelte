import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import webpack from "webpack";
import { OptimizeComponentsPlugin } from "../src/plugins/OptimizeComponentsPlugin";
import { createFakeProject } from "./helpers/fake-project";

const IMPORT_BUTTON = `import { Button } from "carbon-components-svelte";`;
const SVELTE_FILE = /\.svelte$/;
const SVELTE_LOADER = path.join(
  import.meta.dir,
  "helpers/svelte-source-loader.cjs",
);
const MISSED_TOOLBAR =
  /OptimizeComponentsPlugin rewrote Carbon components before seeing lib[\\/]toolbar\.js/;

/**
 * Builds `files` under a fake project with real webpack. `.svelte` files
 * are bundled as their source text (see `svelte-source-loader.cjs`), so the
 * bundle shows what Svelte would have compiled.
 */
async function build(
  files: Record<string, string>,
  mode: "production" | "development" = "production",
) {
  const project = createFakeProject();
  project.linkCarbon();
  for (const [file, code] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(project.root, file)), { recursive: true });
    writeFileSync(path.join(project.root, file), code);
  }
  const compiler = webpack({
    mode,
    context: project.root,
    entry: "./src/index.js",
    output: { path: path.join(project.root, "out") },
    module: { rules: [{ test: SVELTE_FILE, loader: SVELTE_LOADER }] },
    optimization: { minimize: false },
    devtool: false,
    plugins: [new OptimizeComponentsPlugin({ silent: true })],
    infrastructureLogging: { level: "none" },
  });
  const stats = await new Promise<webpack.Stats>((resolve, reject) =>
    compiler.run((error, result) =>
      error || !result ? reject(error) : resolve(result),
    ),
  );
  await new Promise((resolve) => compiler.close(resolve));
  const bundle = path.join(project.root, "out", "main.js");
  return {
    stats,
    code: stats.hasErrors() ? "" : readFileSync(bundle, "utf8"),
    dispose: project.dispose,
  };
}

const APP = {
  "src/App.svelte": `<script>${IMPORT_BUTTON}</script>\n<Button kind="tertiary">Save</Button>`,
  "src/index.js": `import App from "./App.svelte";\nconsole.log(App);`,
};

describe("OptimizeComponentsPlugin", () => {
  test("hands the next loader Carbon rewritten for the app", async () => {
    const { stats, code, dispose } = await build(APP);
    try {
      expect(stats.hasErrors()).toBe(false);
      expect(code).toContain(String.raw`\"bx--btn--tertiary\"`);
      expect(code).not.toContain("<ButtonSkeleton");
    } finally {
      dispose();
    }
  });

  test("leaves development builds alone", async () => {
    const { code, dispose } = await build(APP, "development");
    try {
      expect(code).toContain("<ButtonSkeleton");
    } finally {
      dispose();
    }
  });

  test("fails the build when a module outside `content` renders Carbon", async () => {
    const { stats, dispose } = await build({
      ...APP,
      "src/index.js": `${APP["src/index.js"]}\nimport "../lib/toolbar.js";`,
      "lib/toolbar.js": `${IMPORT_BUTTON}\nconsole.log(Button);`,
    });
    try {
      const errors = stats.toJson({ errors: true }).errors ?? [];
      expect(errors.map((error) => error.message).join("\n")).toMatch(
        MISSED_TOOLBAR,
      );
    } finally {
      dispose();
    }
  });
});
