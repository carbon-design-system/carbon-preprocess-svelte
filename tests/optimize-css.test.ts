import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Rollup } from "vite";
import { CarbonSvelte } from "../src/constants";
import {
  contentMatchedNothing,
  NO_CARBON_IMPORTS,
} from "../src/plugins/messages";
import { optimizeCss } from "../src/plugins/optimize-css";

type OutputAsset = Rollup.OutputAsset;
type OutputBundle = Rollup.OutputBundle;

const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;
const SIZE_BLOCK_HEADER = /^\n\nOptimized styles\.css\nBefore: /;

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
    logger?: { info: (message: string) => void };
  }) => void;
  buildStart: () => Promise<void>;
  transform: (code: string, id: string) => void;
  generateBundle: (
    this: { warn: (message: string) => void },
    options: unknown,
    bundle: OutputBundle,
  ) => Promise<void>;
};

function resolvePlugin(plugin: Rollup.Plugin): ResolvedPlugin {
  return plugin as unknown as ResolvedPlugin;
}

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
    plugin.transform("", carbonComponent);

    const bundle = makeCssBundle(cssContent);
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toEqual(
      ".bx--btn { color: blue }",
    );
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  test("does not leak imported component ids into the next build", async () => {
    // Regression test: a long-running `vite build --watch` session reuses the
    // same plugin instance across rebuilds. If tracked ids aren't reset, a
    // component removed from the app in a later rebuild still keeps its CSS
    // classes alive, silently degrading optimization over time.
    const plugin = resolvePlugin(optimizeCss());
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;

    // First build: Button is imported.
    const firstCtx = { warn: jest.fn() };
    await plugin.buildStart();
    plugin.transform("", carbonComponent);
    const firstBundle = makeCssBundle(cssContent);
    await plugin.generateBundle.call(firstCtx, {}, firstBundle);
    expect((firstBundle["styles.css"] as OutputAsset).source).toEqual(
      ".bx--btn { color: blue }",
    );
    expect(firstCtx.warn).not.toHaveBeenCalled();

    // Second build (rebuild): Button is no longer imported, so `transform`
    // never fires for it this time around.
    const secondCtx = { warn: jest.fn() };
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

  test("keeps literal bx-- classes found in app modules", async () => {
    const plugin = resolvePlugin(optimizeCss({ silent: true }));
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }
.bx--modal { background: red }`;

    await plugin.buildStart();
    plugin.transform("", carbonComponent);
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
    plugin.transform("", carbonComponent);
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
    plugin.transform("", carbonComponent);
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
    plugin.transform("", carbonComponent);
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

    // First build: Button is imported and an app module has a literal token.
    await plugin.buildStart();
    plugin.transform("", carbonComponent);
    plugin.transform('const c = "bx--accordion";', "/app/src/App.svelte");
    const firstBundle = makeCssBundle(cssContent);
    const firstCtx = { warn: jest.fn() };
    await plugin.generateBundle.call(firstCtx, {}, firstBundle);
    expect((firstBundle["styles.css"] as OutputAsset).source).toEqual(
      cssContent,
    );

    // Second build: Button is re-imported but the app module is gone. If
    // `moduleClasses` leaked across builds, `.bx--accordion` would survive.
    await plugin.buildStart();
    plugin.transform("", carbonComponent);
    const secondBundle = makeCssBundle(cssContent);
    const secondCtx = { warn: jest.fn() };
    await plugin.generateBundle.call(secondCtx, {}, secondBundle);

    expect((secondBundle["styles.css"] as OutputAsset).source).toEqual(
      ".bx--btn { color: blue }",
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
.bx--modal { background: red }`;

      await plugin.buildStart();
      plugin.configResolved({ root: dir });
      plugin.transform("", carbonComponent);

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
      plugin.configResolved({ root: dir });
      // @ts-expect-error
      plugin.transform("", carbonComponent);

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
      const plugin = optimizeCss({
        silent: true,
        content: ["nope/**/*.svelte"],
      });
      const cssContent = ".bx--btn { color: blue }";
      const ctx = { warn: jest.fn() };

      // @ts-expect-error
      await plugin.buildStart();
      // @ts-expect-error
      plugin.configResolved({ root: dir });
      // @ts-expect-error
      plugin.transform("", carbonComponent);

      const bundle = makeCssBundle(cssContent);
      // @ts-expect-error
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
    plugin.transform("", carbonComponent);

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
    plugin.transform("", carbonComponent);

    const bundle = makeCssBundle(cssContent);
    const ctx = { warn: jest.fn() };
    // @ts-expect-error
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toEqual(cssContent);
    expect(consoleSpy.mock.calls).toContainEqual([
      "Dry run: styles.css left unchanged",
    ]);
    expect(consoleSpy.mock.calls).toContainEqual(["Optimized", "styles.css"]);
    expect(consoleSpy.mock.calls.some((call) => call[0] === "Before:")).toEqual(
      true,
    );
    expect(consoleSpy.mock.calls.some((call) => call[0] === "After: ")).toEqual(
      true,
    );

    consoleSpy.mockRestore();
  });

  test("report prints detected components and assets", async () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const plugin = resolvePlugin(optimizeCss({ report: true, silent: true }));
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }
.bx--modal { background: red }`;

    await plugin.buildStart();
    plugin.transform("", carbonComponent);
    plugin.transform('const c = "bx--accordion";', "/app/src/App.svelte");

    const bundle = makeCssBundle(cssContent);
    const ctx = { warn: jest.fn() };
    await plugin.generateBundle.call(ctx, {}, bundle);

    const lines = consoleSpy.mock.calls.map((call) => call.join(" "));

    expect(
      lines.some((line) => line.includes("Detected components (1): Button")),
    ).toEqual(true);
    expect(lines.some((line) => line.includes("module scan 1 tokens"))).toEqual(
      true,
    );
    expect(
      lines.some(
        (line) => line.includes("styles.css") && line.includes("rules removed"),
      ),
    ).toEqual(true);
    expect(
      lines.some(
        (line) => line.includes("Optimized") && line.includes("Before:"),
      ),
    ).toEqual(false);

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
      plugin.configResolved({ root: dir });
      // @ts-expect-error
      plugin.transform("", carbonComponent);

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
    plugin.transform("", carbonComponent);

    const bundle = makeCssBundle(cssContent);
    const ctx = { warn: jest.fn() };
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [message] = logger.info.mock.calls[0];
    expect(message).toMatch(SIZE_BLOCK_HEADER);
    expect(message).toContain("\nAfter:  ");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  test("falls back to console.log without Vite", async () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const plugin = resolvePlugin(optimizeCss());
    const cssContent =
      ".bx--btn { color: blue }\n.bx--accordion { background: yellow }";

    await plugin.buildStart();
    plugin.transform("", carbonComponent);

    const bundle = makeCssBundle(cssContent);
    const ctx = { warn: jest.fn() };
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect(consoleSpy).toHaveBeenCalledTimes(4);
    expect(consoleSpy.mock.calls[1]).toEqual(["Optimized", "styles.css"]);
  });

  test("silent suppresses the logger path too", async () => {
    const plugin = resolvePlugin(optimizeCss({ silent: true }));
    const logger = { info: jest.fn() };
    const cssContent =
      ".bx--btn { color: blue }\n.bx--accordion { background: yellow }";

    await plugin.buildStart();
    plugin.configResolved({ root: process.cwd(), logger });
    plugin.transform("", carbonComponent);

    const bundle = makeCssBundle(cssContent);
    const ctx = { warn: jest.fn() };
    await plugin.generateBundle.call(ctx, {}, bundle);

    expect(logger.info).not.toHaveBeenCalled();
  });
});
