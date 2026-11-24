// @depends-on tests/helpers/svelte-source-loader.cjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { optimizerRegistry } from "svelte-prune/internal";
import webpack from "webpack";
import { stripVTControlCharacters } from "node:util";
import { OptimizeComponentsPlugin } from "../src/plugins/OptimizeComponentsPlugin";
import { OptimizeCssPlugin } from "../src/plugins/OptimizeCssPlugin";
import { createFakeProject } from "./helpers/fake-project";
import { resolvePackageRoot } from "./helpers/resolve-package-root";

const IMPORT_BUTTON = `import { Button } from "carbon-components-svelte";`;
const SVELTE_FILE = /\.svelte$/;
const SVELTE_LOADER = path.join(
  import.meta.dir,
  "helpers/svelte-source-loader.cjs",
);
const CARD_ESCAPED =
  /read the props of src[\\/]Card\.svelte from its call sites in `content`, but lib[\\/]extra\.js also renders it\./;
const UNREAD_MODAL =
  /can't read how src[\\/]App\.svelte imports `@carbon\/src\/Modal\/Modal\.svelte`/;
const REWROTE_AND_PRUNED =
  /^carbon-preprocess-svelte: rewrote [1-9]\d* Carbon components? and pruned their CSS\n/;
const MISSED_TOOLBAR =
  /OptimizeComponentsPlugin rewrote Carbon components before seeing lib[\\/]toolbar\.js/;

/**
 * Builds `files` under a fake project with real webpack. `.svelte` files
 * are bundled as their source text (see `svelte-source-loader.cjs`), so the
 * bundle shows what Svelte would have compiled.
 */
async function build(
  files: Record<string, string>,
  mode: "production" | "development" | undefined = "production",
  resolve: webpack.Configuration["resolve"] = {},
  plugins: webpack.Configuration["plugins"] = [
    new OptimizeComponentsPlugin({ silent: true }),
  ],
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
    resolve,
    optimization: { minimize: false },
    devtool: false,
    plugins,
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

  test("hands the count to OptimizeCssPlugin, which prints one header", async () => {
    // A stylesheet with Carbon rules, as a CSS loader would emit.
    const emitCss: webpack.WebpackPluginInstance = {
      apply(compiler) {
        compiler.hooks.thisCompilation.tap("emit-css", (compilation) => {
          compilation.hooks.processAssets.tap(
            {
              name: "emit-css",
              stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
            },
            () => {
              compilation.emitAsset(
                "styles.css",
                new webpack.sources.RawSource(
                  ".bx--btn { color: blue }\n.bx--accordion { color: red }",
                ),
              );
            },
          );
        });
      },
    };
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const { stats, dispose } = await build(APP, "production", {}, [
      new OptimizeComponentsPlugin(),
      new OptimizeCssPlugin(),
      emitCss,
    ]);
    const lines = log.mock.calls.map(([line]) =>
      stripVTControlCharacters(String(line)),
    );
    log.mockRestore();
    try {
      expect(stats.hasErrors()).toBe(false);
      expect(lines).toEqual([expect.stringMatching(REWROTE_AND_PRUNED)]);
    } finally {
      dispose();
    }
  });

  test("a config without `mode` builds for production, like webpack", async () => {
    const before = optimizerRegistry().size;
    const { stats, code, dispose } = await build(APP, undefined);
    try {
      expect(stats.hasErrors()).toBe(false);
      expect(code).not.toContain("<ButtonSkeleton");
      // Closing the compiler forgets its optimizer.
      expect(optimizerRegistry().size).toBe(before);
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

  test("follows a wrapper's props, unless something outside `content` renders it", async () => {
    const files = {
      "src/App.svelte": `<script>import Card from "./Card.svelte";</script>\n<Card tone="danger" />`,
      "src/Card.svelte": `<script>${IMPORT_BUTTON}\nexport let tone = "primary";</script>\n<Button kind={tone} />`,
      "src/index.js": `import App from "./App.svelte";\nconsole.log(App);`,
    };
    const wrapped = await build(files);
    try {
      expect(wrapped.stats.hasErrors()).toBe(false);
      expect(wrapped.code).toContain(String.raw`\"bx--btn--danger\"`);
      // The wrapper itself, rewritten for its one call site.
      expect(wrapped.code).toContain(String.raw`kind={\"danger\"}`);
    } finally {
      wrapped.dispose();
    }

    const escaped = await build({
      ...files,
      "src/index.js": `${files["src/index.js"]}\nimport "../lib/extra.js";`,
      "lib/extra.js": `import Card from "../src/Card.svelte";\nconsole.log(Card);`,
    });
    try {
      const errors = escaped.stats.toJson({ errors: true }).errors ?? [];
      expect(errors.map((error) => error.message).join("\n")).toMatch(
        CARD_ESCAPED,
      );
    } finally {
      escaped.dispose();
    }
  });

  test("fails the build on an import of Carbon the analysis can't read", async () => {
    const { stats, dispose } = await build(
      {
        ...APP,
        "src/App.svelte": `<script>${IMPORT_BUTTON}\nimport Modal from "@carbon/src/Modal/Modal.svelte";</script>\n<Button kind="tertiary">Save</Button><Modal open />`,
      },
      "production",
      { alias: { "@carbon": resolvePackageRoot("carbon-components-svelte") } },
    );
    try {
      const errors = stats.toJson({ errors: true }).errors ?? [];
      expect(errors.map((error) => error.message).join("\n")).toMatch(
        UNREAD_MODAL,
      );
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
