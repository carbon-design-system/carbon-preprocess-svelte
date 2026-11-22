import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Rollup } from "vite";
import { CarbonSvelte } from "../src/constants";
import { resolveCarbonRoot } from "../src/indexer/resolve-carbon-root";
import {
  contentMatchedNothing,
  NO_CARBON_IMPORTS,
} from "../src/plugins/messages";
import { optimizeCss } from "../src/plugins/optimize-css";
import type { OptimizeCssOptions } from "../src/plugins/options";

import { createFakeProject } from "./helpers/fake-project";

type OutputAsset = Rollup.OutputAsset;
type OutputBundle = Rollup.OutputBundle;

/** Carbon's Button, and an app module that renders it, as a build transforms them. */
const carbonComponent = join(resolveCarbonRoot(), "src/Button/Button.svelte");
const appDir = mkdtempSync(join(tmpdir(), "optimize-css-app-"));
const buttonApp = join(appDir, "ButtonApp.svelte");
const BUTTON_APP = `<script>
  import { Button } from "carbon-components-svelte";
</script>
<Button>Save</Button>`;
writeFileSync(buttonApp, BUTTON_APP);
afterAll(() => rmSync(appDir, { recursive: true, force: true }));

/** Transforms Button and the app module that renders it. */
function importButton(plugin: ResolvedPlugin): void {
  plugin.transform(BUTTON_APP, buttonApp);
  plugin.transform("", carbonComponent);
}
/** The summary for one pruned stylesheet: a header, then its row. */
const SIZE_LINE =
  /^carbon-preprocess-svelte: pruned Carbon CSS\n {2}styles\.css {2}[\d.,]+ kB {2}→ {2}[\d.,]+ kB {2}-\d+%$/;
/** No-op Vite logger for tests that ignore log output. */
const quietLogger = { info: () => {} };

function makeCssBundle(source: string): OutputBundle {
  return {
    "styles.css": {
      type: "asset",
      source,
    } as OutputAsset,
  } as unknown as OutputBundle;
}

type ResolvedPlugin = {
  configResolved: (config: {
    root: string;
    logger: { info: (message: string) => void };
    build?: { cssCodeSplit?: boolean };
  }) => void;
  renderStart: (this: { warn: (message: string) => void }) => Promise<void>;
  augmentChunkHash: (chunk: {
    dynamicImports: string[];
    viteMetadata?: { importedAssets: Set<string> };
  }) => string | undefined;
  buildStart: () => Promise<void>;
  transform: (code: string, id: string) => void;
  generateBundle: (
    this: {
      warn: (message: string) => void;
      getModuleIds?: () => IterableIterator<string>;
    },
    options: unknown,
    bundle: OutputBundle,
  ) => Promise<void>;
};

function resolvePlugin(plugin: Rollup.Plugin): ResolvedPlugin {
  return plugin as unknown as ResolvedPlugin;
}

/**
 * A `generateBundle` context whose module graph holds exactly `moduleIds`,
 * and the app module that renders Button with it.
 */
function graphContext(...moduleIds: string[]) {
  const ids = moduleIds.includes(carbonComponent)
    ? [...moduleIds, buttonApp]
    : moduleIds;
  return {
    warn: jest.fn(),
    getModuleIds: () => ids.values(),
  };
}

describe("optimizeCss (Vite plugin): Carbon can't be read", () => {
  test("warns once and leaves CSS unpruned", async () => {
    const project = createFakeProject();
    project.installBrokenCarbon();
    try {
      const plugin = resolvePlugin(optimizeCss());
      plugin.configResolved({ root: project.root, logger: quietLogger });
      const ctx = { warn: jest.fn() };
      await (
        plugin.buildStart as unknown as (this: typeof ctx) => Promise<void>
      ).call(ctx);
      plugin.transform(
        "",
        `node_modules/${CarbonSvelte.Components}/Button.svelte`,
      );
      const css = ".bx--btn{color:red}.bx--accordion{color:blue}";
      const bundle = makeCssBundle(css);
      await plugin.generateBundle.call(ctx, {}, bundle);

      expect((bundle["styles.css"] as OutputAsset).source).toBe(css);
      expect(ctx.warn).toHaveBeenCalledTimes(1);
      expect(ctx.warn.mock.calls[0][0]).toContain(
        "Carbon CSS is left unpruned",
      );
    } finally {
      project.dispose();
    }
  });
});

describe("optimizeCss (Vite plugin)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("prunes unused Carbon classes when a component is imported", async () => {
    const plugin = resolvePlugin(optimizeCss({ silent: true }));
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;
    const ctx = { warn: jest.fn() };

    await plugin.buildStart();
    importButton(plugin);

    const bundle = makeCssBundle(cssContent);
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toEqual(
      ".bx--btn { color: blue }",
    );
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  test("does not leak imported component ids into the next build", async () => {
    // Regression test: a long-running `vite build --watch` session reuses the
    // same plugin instance across rebuilds. If a component removed from the
    // app in a later rebuild were still tracked, it would keep its CSS
    // classes alive, silently degrading optimization over time.
    const plugin = resolvePlugin(optimizeCss());
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;

    // First build: Button is imported.
    const firstCtx = graphContext(carbonComponent);
    await plugin.buildStart();
    importButton(plugin);
    const firstBundle = makeCssBundle(cssContent);
    await plugin.generateBundle.call(firstCtx, {}, firstBundle);
    expect((firstBundle["styles.css"] as OutputAsset).source).toEqual(
      ".bx--btn { color: blue }",
    );
    expect(firstCtx.warn).not.toHaveBeenCalled();

    // Second build (rebuild): Button is no longer imported, so it's gone
    // from the module graph.
    const secondCtx = graphContext("/app/src/App.svelte");
    await plugin.buildStart();
    const secondBundle = makeCssBundle(cssContent);
    await plugin.generateBundle.call(secondCtx, {}, secondBundle);

    // No Carbon components are tracked anymore, so the plugin should warn
    // and skip optimization, leaving the CSS untouched.
    expect((secondBundle["styles.css"] as OutputAsset).source).toEqual(
      cssContent,
    );
    expect(secondCtx.warn).toHaveBeenCalledTimes(1);
    expect(secondCtx.warn).toHaveBeenCalledWith(NO_CARBON_IMPORTS);
  });

  test("removes Carbon tokens nothing in the build reads", async () => {
    const plugin = resolvePlugin(optimizeCss({ silent: true }));
    await plugin.buildStart();
    importButton(plugin);
    const script = "/app/src/theme.ts";
    const modules: Record<string, string> = {
      [buttonApp]: BUTTON_APP,
      [carbonComponent]: "",
      [script]: 'el.style.setProperty("color", "var(--cds-ai-aura-end)")',
    };
    const ctx = {
      warn: jest.fn(),
      getModuleIds: () => Object.keys(modules)[Symbol.iterator](),
      getModuleInfo: (id: string) => ({ code: modules[id] }),
    };
    const bundle = makeCssBundle(
      ":root{--cds-ai-aura-start:1;--cds-ai-aura-end:2;--cds-ai-aura-hover-start:3}.bx--btn{color:var(--cds-ai-aura-start)}",
    );
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toBe(
      ":root{--cds-ai-aura-start:1;--cds-ai-aura-end:2}.bx--btn{color:var(--cds-ai-aura-start)}",
    );
  });

  test("`fontDisplay` sets IBM Plex's, and leaves other fonts alone", async () => {
    const plugin = resolvePlugin(
      optimizeCss({ silent: true, fontDisplay: "swap" }),
    );
    await plugin.buildStart();
    importButton(plugin);

    const plex =
      "@font-face{font-display:auto;font-family:IBM Plex Sans;src:url(a.woff2)}";
    const other =
      "@font-face{font-display:auto;font-family:Inter;src:url(b.woff2)}";
    const bundle = makeCssBundle(`${plex}${other}.bx--btn{color:red}`);
    await plugin.generateBundle.call({ warn: jest.fn() }, {}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toBe(
      `${plex.replace("auto", "swap")}${other}.bx--btn{color:red}`,
    );
  });

  test("prunes before other plugins read CSS names under Vite", () => {
    const plugin = resolvePlugin(optimizeCss());
    plugin.configResolved({ root: process.cwd(), logger: quietLogger });
    expect(typeof plugin.generateBundle).toBe("function");

    plugin.configResolved({
      root: process.cwd(),
      logger: quietLogger,
      build: {},
    });
    expect(plugin.generateBundle).toMatchObject({ order: "pre" });

    // Vite emits the CSS in `generateBundle` then.
    plugin.configResolved({
      root: process.cwd(),
      logger: quietLogger,
      build: { cssCodeSplit: false },
    });
    expect(typeof plugin.generateBundle).toBe("function");
  });

  test("prunes around Vite's hash marker and puts it back", async () => {
    const plugin = resolvePlugin(optimizeCss({ silent: true }));
    await plugin.buildStart();
    importButton(plugin);

    const bundle = makeCssBundle(
      ".bx--btn { color: blue }\n.bx--accordion { background: yellow }/*$vite$:1*/",
    );
    await plugin.generateBundle.call({ warn: jest.fn() }, {}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toBe(
      ".bx--btn { color: blue }/*$vite$:1*/",
    );
  });

  test("hashes what it keeps into chunks that name CSS", async () => {
    const fingerprintFor = async (options: OptimizeCssOptions) => {
      const plugin = resolvePlugin(optimizeCss({ silent: true, ...options }));
      await plugin.buildStart();
      importButton(plugin);
      await plugin.renderStart.call({ warn: jest.fn() });
      return {
        lazy: plugin.augmentChunkHash({ dynamicImports: ["page.js"] }),
        url: plugin.augmentChunkHash({
          dynamicImports: [],
          viteMetadata: { importedAssets: new Set(["assets/x.css"]) },
        }),
        plain: plugin.augmentChunkHash({ dynamicImports: [] }),
      };
    };

    const base = await fingerprintFor({});
    expect(base.lazy).toEqual(expect.any(String));
    expect(base.url).toBe(base.lazy);
    expect(base.plain).toBeUndefined();
    expect((await fingerprintFor({})).lazy).toBe(base.lazy);
    expect((await fingerprintFor({ safelist: [".bx--modal"] })).lazy).not.toBe(
      base.lazy,
    );
  });

  test("keeps literal bx-- classes found in app modules", async () => {
    const plugin = resolvePlugin(optimizeCss({ silent: true }));
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }
.bx--data-table { background: red }`;

    await plugin.buildStart();
    importButton(plugin);
    plugin.transform('const c = "bx--accordion";', "/app/src/App.svelte");

    const bundle = makeCssBundle(cssContent);
    const ctx = { warn: jest.fn() };
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toEqual(
      `.bx--btn { color: blue }
.bx--accordion { background: yellow }`,
    );
  });

  test("scanModules: false ignores app modules", async () => {
    const plugin = resolvePlugin(
      optimizeCss({ silent: true, scanModules: false }),
    );
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;

    await plugin.buildStart();
    importButton(plugin);
    plugin.transform('const c = "bx--accordion";', "/app/src/App.svelte");

    const bundle = makeCssBundle(cssContent);
    const ctx = { warn: jest.fn() };
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toEqual(
      ".bx--btn { color: blue }",
    );
  });

  test("does not scan CSS modules or virtual modules", async () => {
    const plugin = resolvePlugin(optimizeCss({ silent: true }));
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;

    await plugin.buildStart();
    importButton(plugin);
    plugin.transform(
      "bx--accordion",
      "/app/src/App.svelte?svelte&type=style&lang.css",
    );
    plugin.transform("bx--accordion", "\0virtual:thing");

    const bundle = makeCssBundle(cssContent);
    const ctx = { warn: jest.fn() };
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toEqual(
      ".bx--btn { color: blue }",
    );
  });

  test("does not scan Carbon's own non-component sources", async () => {
    const plugin = resolvePlugin(optimizeCss({ silent: true }));
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;

    await plugin.buildStart();
    importButton(plugin);
    plugin.transform(
      "bx--accordion",
      `/n/node_modules/${CarbonSvelte.Components}/src/utils/x.js`,
    );

    const bundle = makeCssBundle(cssContent);
    const ctx = { warn: jest.fn() };
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toEqual(
      ".bx--btn { color: blue }",
    );
  });

  test("clears module classes between watch-mode rebuilds", async () => {
    const plugin = resolvePlugin(optimizeCss({ silent: true }));
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;
    const app = "/app/src/App.svelte";

    // First build: Button is imported and an app module has a literal token.
    await plugin.buildStart();
    importButton(plugin);
    plugin.transform('const c = "bx--accordion";', app);
    const firstBundle = makeCssBundle(cssContent);
    const firstCtx = graphContext(carbonComponent, app);
    await plugin.generateBundle.call(firstCtx, {}, firstBundle);
    expect((firstBundle["styles.css"] as OutputAsset).source).toEqual(
      cssContent,
    );

    // Second build: Button is re-imported but the app module is gone. If
    // its classes outlived it, `.bx--accordion` would survive.
    await plugin.buildStart();
    importButton(plugin);
    const secondBundle = makeCssBundle(cssContent);
    const secondCtx = graphContext(carbonComponent);
    await plugin.generateBundle.call(secondCtx, {}, secondBundle);

    expect((secondBundle["styles.css"] as OutputAsset).source).toEqual(
      ".bx--btn { color: blue }",
    );
  });

  test("keeps cached modules' ids and classes on watch-mode rebuilds", async () => {
    // Regression test: on a `vite build --watch` rebuild, Rollup serves
    // unchanged modules from its cache without calling `transform`. They're
    // still in the module graph, so they must still count.
    const plugin = resolvePlugin(optimizeCss({ silent: true }));
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }
.bx--data-table { background: red }`;
    const app = "/app/src/App.svelte";
    const other = "/app/src/other.ts";

    await plugin.buildStart();
    importButton(plugin);
    plugin.transform('const c = "bx--accordion";', app);
    plugin.transform("export {};", other);
    await plugin.generateBundle.call(
      graphContext(carbonComponent, app, other),
      {},
      makeCssBundle(cssContent),
    );

    // Rebuild after an edit to `other`: only it is re-transformed.
    await plugin.buildStart();
    plugin.transform("export const x = 1;", other);
    const bundle = makeCssBundle(cssContent);
    const ctx = graphContext(carbonComponent, app, other);
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect(ctx.warn).not.toHaveBeenCalled();
    expect((bundle["styles.css"] as OutputAsset).source).toEqual(
      `.bx--btn { color: blue }
.bx--accordion { background: yellow }`,
    );
  });

  test("replaces a re-transformed module's classes on watch-mode rebuilds", async () => {
    const plugin = resolvePlugin(optimizeCss({ silent: true }));
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }
.bx--data-table { background: red }`;
    const app = "/app/src/App.svelte";

    await plugin.buildStart();
    importButton(plugin);
    plugin.transform('const c = "bx--accordion";', app);
    await plugin.generateBundle.call(
      graphContext(carbonComponent, app),
      {},
      makeCssBundle(cssContent),
    );

    // The edit swaps `bx--accordion` for `bx--data-table`.
    await plugin.buildStart();
    plugin.transform('const c = "bx--data-table";', app);
    const bundle = makeCssBundle(cssContent);
    await plugin.generateBundle.call(
      graphContext(carbonComponent, app),
      {},
      bundle,
    );

    expect((bundle["styles.css"] as OutputAsset).source).toEqual(
      `.bx--btn { color: blue }
.bx--data-table { background: red }`,
    );
  });

  test("content globs resolve from Vite's config.root", async () => {
    const dir = mkdtempSync(join(tmpdir(), "optimize-css-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(
        join(dir, "src", "App.svelte"),
        '<div class="bx--accordion"></div>',
      );

      const plugin = resolvePlugin(
        optimizeCss({
          silent: true,
          content: ["src/**/*.svelte"],
        }),
      );
      const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }
.bx--data-table { background: red }`;

      await plugin.buildStart();
      plugin.configResolved({ root: dir, logger: quietLogger });
      importButton(plugin);

      const bundle = makeCssBundle(cssContent);
      const ctx = { warn: jest.fn() };
      await plugin.generateBundle.call(ctx, {}, bundle);

      expect((bundle["styles.css"] as OutputAsset).source).toEqual(
        `.bx--btn { color: blue }
.bx--accordion { background: yellow }`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("warns when no Carbon component was imported", async () => {
    const plugin = resolvePlugin(optimizeCss());
    const cssContent = ".bx--btn { color: blue }";
    const ctx = { warn: jest.fn() };

    await plugin.buildStart();

    const bundle = makeCssBundle(cssContent);
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect(ctx.warn).toHaveBeenCalledTimes(1);
    expect(ctx.warn).toHaveBeenCalledWith(NO_CARBON_IMPORTS);
    expect((bundle["styles.css"] as OutputAsset).source).toEqual(cssContent);
  });

  test("silent suppresses the no-imports warning", async () => {
    const plugin = resolvePlugin(optimizeCss({ silent: true }));
    const cssContent = ".bx--btn { color: blue }";
    const ctx = { warn: jest.fn() };

    await plugin.buildStart();

    const bundle = makeCssBundle(cssContent);
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect(ctx.warn).not.toHaveBeenCalled();
  });

  test("does not warn when no asset contains Carbon CSS", async () => {
    // A secondary build (a second webpack config, a worker entry) that never
    // imports Carbon should not warn.
    const plugin = resolvePlugin(optimizeCss());
    const cssContent = "body { color: red }";
    const ctx = { warn: jest.fn() };

    await plugin.buildStart();

    const bundle = makeCssBundle(cssContent);
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect(ctx.warn).not.toHaveBeenCalled();
    expect((bundle["styles.css"] as OutputAsset).source).toEqual(cssContent);
  });

  test("warns when content globs match nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "optimize-css-"));
    try {
      const plugin = optimizeCss({ content: ["nope/**/*.svelte"] });
      const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;
      const ctx = { warn: jest.fn() };

      // @ts-expect-error
      await plugin.buildStart();
      // @ts-expect-error
      plugin.configResolved({ root: dir, logger: quietLogger });
      // @ts-expect-error
      importButton(plugin);

      const bundle = makeCssBundle(cssContent);
      // @ts-expect-error
      await plugin.generateBundle.call(ctx, {}, bundle);

      expect(ctx.warn).toHaveBeenCalledTimes(1);
      expect(ctx.warn).toHaveBeenCalledWith(
        contentMatchedNothing(["nope/**/*.svelte"], dir),
      );
      expect((bundle["styles.css"] as OutputAsset).source).toEqual(
        ".bx--btn { color: blue }",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("silent suppresses the content-globs-matched-nothing warning", async () => {
    const dir = mkdtempSync(join(tmpdir(), "optimize-css-"));
    try {
      const plugin = resolvePlugin(
        optimizeCss({ silent: true, content: ["nope/**/*.svelte"] }),
      );
      const cssContent = ".bx--btn { color: blue }";
      const ctx = { warn: jest.fn() };

      await plugin.buildStart();
      plugin.configResolved({ root: dir, logger: quietLogger });
      importButton(plugin);

      const bundle = makeCssBundle(cssContent);
      await plugin.generateBundle.call(ctx, {}, bundle);

      expect(ctx.warn).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("dryRun leaves the asset untouched", async () => {
    const plugin = optimizeCss({ dryRun: true, silent: true });
    const cssContent =
      ".bx--btn { color: blue }\n.bx--accordion { background: yellow }";

    // @ts-expect-error
    await plugin.buildStart();
    // @ts-expect-error
    importButton(plugin);

    const bundle = makeCssBundle(cssContent);
    const ctx = { warn: jest.fn() };
    // @ts-expect-error
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toEqual(cssContent);
  });

  test("dryRun still logs the size diff and a dry-run line", async () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const plugin = optimizeCss({ dryRun: true, silent: false });
    const cssContent =
      ".bx--btn { color: blue }\n.bx--accordion { background: yellow }";

    // @ts-expect-error
    await plugin.buildStart();
    // @ts-expect-error
    importButton(plugin);

    const bundle = makeCssBundle(cssContent);
    const ctx = { warn: jest.fn() };
    // @ts-expect-error
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toEqual(cssContent);
    expect(
      consoleSpy.mock.calls.some((call) =>
        String(call[0]).startsWith(
          "carbon-preprocess-svelte: dry run, files unchanged: would prune Carbon CSS\n  styles.css ",
        ),
      ),
    ).toEqual(true);

    consoleSpy.mockRestore();
  });

  test("report prints detected components and assets", async () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const plugin = resolvePlugin(optimizeCss({ report: true, silent: true }));
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }
.bx--data-table { background: red }`;

    await plugin.buildStart();
    importButton(plugin);
    plugin.transform('const c = "bx--accordion";', "/app/src/App.svelte");

    const bundle = makeCssBundle(cssContent);
    const ctx = { warn: jest.fn() };
    await plugin.generateBundle.call(ctx, {}, bundle);

    const lines = consoleSpy.mock.calls.map((call) => call.join(" "));

    expect(
      lines.some(
        (line) =>
          line.includes("Components that can render") &&
          line.includes("Button"),
      ),
    ).toEqual(true);
    expect(lines.some((line) => line.includes("module scan 1 tokens"))).toEqual(
      true,
    );
    expect(
      lines.some(
        (line) => line.includes("styles.css") && line.includes("rules removed"),
      ),
    ).toEqual(true);
    expect(lines.some((line) => line.includes(" → "))).toEqual(false);

    consoleSpy.mockRestore();
  });

  test("does not warn when content globs match", async () => {
    const dir = mkdtempSync(join(tmpdir(), "optimize-css-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(
        join(dir, "src", "App.svelte"),
        '<div class="bx--accordion"></div>',
      );

      const plugin = optimizeCss({ content: ["src/**/*.svelte"] });
      const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;
      const ctx = { warn: jest.fn() };

      // @ts-expect-error
      await plugin.buildStart();
      // @ts-expect-error
      plugin.configResolved({ root: dir, logger: quietLogger });
      // @ts-expect-error
      importButton(plugin);

      const bundle = makeCssBundle(cssContent);
      // @ts-expect-error
      await plugin.generateBundle.call(ctx, {}, bundle);

      expect(ctx.warn).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("uses Vite's logger when configResolved ran", async () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const plugin = resolvePlugin(optimizeCss());
    const logger = { info: jest.fn() };
    const cssContent =
      ".bx--btn { color: blue }\n.bx--accordion { background: yellow }";

    await plugin.buildStart();
    plugin.configResolved({ root: process.cwd(), logger });
    importButton(plugin);

    const bundle = makeCssBundle(cssContent);
    const ctx = { warn: jest.fn() };
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [message] = logger.info.mock.calls[0];
    expect(message).toMatch(SIZE_LINE);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  test("falls back to console.log without Vite", async () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const plugin = resolvePlugin(optimizeCss());
    const cssContent =
      ".bx--btn { color: blue }\n.bx--accordion { background: yellow }";

    await plugin.buildStart();
    importButton(plugin);

    const bundle = makeCssBundle(cssContent);
    const ctx = { warn: jest.fn() };
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls[0][0]).toMatch(SIZE_LINE);
  });

  test("silent suppresses the logger path too", async () => {
    const plugin = resolvePlugin(optimizeCss({ silent: true }));
    const logger = { info: jest.fn() };
    const cssContent =
      ".bx--btn { color: blue }\n.bx--accordion { background: yellow }";

    await plugin.buildStart();
    plugin.configResolved({ root: process.cwd(), logger });
    importButton(plugin);

    const bundle = makeCssBundle(cssContent);
    const ctx = { warn: jest.fn() };
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect(logger.info).not.toHaveBeenCalled();
  });
});
