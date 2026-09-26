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
import { createFakeProject } from "./helpers/fake-project";

type OutputAsset = Rollup.OutputAsset;
type OutputBundle = Rollup.OutputBundle;

const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;
const SIZE_BLOCK_HEADER = /^\n\nOptimized styles\.css\nBefore: /;
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
  }) => void;
  buildStart: () => Promise<void>;
  transform: (code: string, id: string) => void;
  generateBundle: (
    this: {
      warn: (message: string) => void;
      getModuleIds?: () => IterableIterator<string>;
      getModuleInfo?: (id: string) => {
        importedIds: string[];
        dynamicallyImportedIds: string[];
        isExternal?: boolean;
        code?: string | null;
      } | null;
    },
    options: unknown,
    bundle: OutputBundle,
  ) => Promise<void>;
};

function resolvePlugin(plugin: Rollup.Plugin): ResolvedPlugin {
  return plugin as unknown as ResolvedPlugin;
}

/** A `generateBundle` context whose module graph holds exactly `moduleIds`. */
function graphContext(...moduleIds: string[]) {
  return {
    warn: jest.fn(),
    getModuleIds: () => moduleIds.values(),
  };
}

describe("optimizeCss (Vite plugin): component index unavailable", () => {
  test("warns once and leaves CSS unpruned", async () => {
    const project = createFakeProject();
    project.installBrokenCarbon();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const plugin = resolvePlugin(optimizeCss());
      plugin.configResolved({ root: project.root, logger: quietLogger });
      await plugin.buildStart();
      plugin.transform(
        "",
        `node_modules/${CarbonSvelte.Components}/Button.svelte`,
      );
      const css = ".bx--btn{color:red}.bx--accordion{color:blue}";
      const bundle = makeCssBundle(css);
      await plugin.generateBundle.call({ warn: jest.fn() }, {}, bundle);

      expect((bundle["styles.css"] as OutputAsset).source).toBe(css);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("leaving Carbon CSS unpruned");
    } finally {
      warn.mockRestore();
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
    // same plugin instance across rebuilds. If a component removed from the
    // app in a later rebuild were still tracked, it would keep its CSS
    // classes alive, silently degrading optimization over time.
    const plugin = resolvePlugin(optimizeCss());
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;

    // First build: Button is imported.
    const firstCtx = graphContext(carbonComponent);
    await plugin.buildStart();
    plugin.transform("", carbonComponent);
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

  test("keeps only the Button kinds app modules pass", async () => {
    const plugin = resolvePlugin(optimizeCss({ silent: true }));
    const cssContent =
      ".bx--btn--primary{a:b}.bx--btn--danger{a:b}.bx--btn--ghost{a:b}";

    await plugin.buildStart();
    plugin.transform("", carbonComponent);
    plugin.transform(
      'Button(node, { kind: "danger" });',
      "/app/src/App.svelte",
    );

    const bundle = makeCssBundle(cssContent);
    await plugin.generateBundle.call({ warn: jest.fn() }, {}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toEqual(
      ".bx--btn--primary{a:b}.bx--btn--danger{a:b}",
    );
  });

  test("reads app modules under a folder named after Carbon", async () => {
    // Carbon's docs site, or an app inside a fork: the `bx--` token scan
    // skips these paths, but a missed literal here would drop its styles.
    const plugin = resolvePlugin(optimizeCss({ silent: true }));
    const cssContent = ".bx--btn--primary{a:b}.bx--btn--danger{a:b}";

    await plugin.buildStart();
    plugin.transform("", carbonComponent);
    plugin.transform(
      'Button(node, { kind: "danger" });',
      "/work/carbon-components-svelte/docs/src/pages/Button.svx",
    );

    const bundle = makeCssBundle(cssContent);
    await plugin.generateBundle.call({ warn: jest.fn() }, {}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toEqual(cssContent);
  });

  test.each([
    ["a dynamic kind", {}, "Button(node, { kind: k });"],
    ["scanModules: false", { scanModules: false }, ""],
  ])("keeps every Button kind with %s", async (_, options, code) => {
    const plugin = resolvePlugin(optimizeCss({ silent: true, ...options }));
    const cssContent = ".bx--btn--primary{a:b}.bx--btn--ghost{a:b}";

    await plugin.buildStart();
    plugin.transform("", carbonComponent);
    plugin.transform(code, "/app/src/App.svelte");

    const bundle = makeCssBundle(cssContent);
    await plugin.generateBundle.call({ warn: jest.fn() }, {}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toEqual(cssContent);
  });

  describe("external modules", () => {
    const cssContent = ".bx--btn--primary{a:b}.bx--btn--ghost{a:b}";
    const app = "/app/src/App.svelte";

    async function build(
      imports: string[],
      infos: Record<string, { isExternal?: boolean; code?: string | null }>,
    ): Promise<string | Uint8Array> {
      const plugin = resolvePlugin(optimizeCss({ silent: true }));
      await plugin.buildStart();
      plugin.transform("", carbonComponent);
      plugin.transform("Button(node, {});", app);

      const graph = [carbonComponent, app, ...Object.keys(infos)];
      const moduleInfo = (id: string) => {
        if (id === app) {
          return { importedIds: imports, dynamicallyImportedIds: [] };
        }
        if (id === carbonComponent) {
          return { importedIds: [], dynamicallyImportedIds: [] };
        }
        const info = infos[id];
        return info
          ? { importedIds: [], dynamicallyImportedIds: [], ...info }
          : null;
      };
      const bundle = makeCssBundle(cssContent);
      await plugin.generateBundle.call(
        {
          warn: jest.fn(),
          getModuleIds: () => graph.values(),
          getModuleInfo: moduleInfo,
        },
        {},
        bundle,
      );
      return (bundle["styles.css"] as OutputAsset).source;
    }

    test("narrows when every import was bundled", async () => {
      expect(await build([carbonComponent], {})).toEqual(
        ".bx--btn--primary{a:b}",
      );
    });

    test("ignores Node built-ins", async () => {
      expect(await build(["node:fs", "path"], {})).toEqual(
        ".bx--btn--primary{a:b}",
      );
    });

    test.each([
      [
        "Rollup lists it with isExternal",
        ["ui-config"],
        { "ui-config": { isExternal: true } },
      ],
      [
        "Rolldown lists it with null code",
        ["ui-config"],
        { "ui-config": { code: null } },
      ],
      ["it has no module info", ["ui-config"], {}],
    ])(
      "keeps every variant when an import is external: %s",
      async (_, imports, infos) => {
        expect(await build(imports, infos)).toEqual(cssContent);
      },
    );
  });

  describe("watch-mode rebuilds", () => {
    const cssContent = ".bx--btn--primary{a:b}.bx--btn--ghost{a:b}";
    const app = "/app/src/App.svelte";

    async function rebuild(
      plugin: ResolvedPlugin,
      moduleIds: string[],
      transformed: Record<string, string>,
    ): Promise<string | Uint8Array> {
      await plugin.buildStart();
      for (const [id, code] of Object.entries(transformed)) {
        plugin.transform(code, id);
      }
      const bundle = makeCssBundle(cssContent);
      await plugin.generateBundle.call(
        { warn: jest.fn(), getModuleIds: () => moduleIds.values() },
        {},
        bundle,
      );
      return (bundle["styles.css"] as OutputAsset).source;
    }

    test("keeps prop values from a module Rollup served from cache", async () => {
      const plugin = resolvePlugin(optimizeCss({ silent: true }));
      const ids = [carbonComponent, app];

      await rebuild(plugin, ids, {
        [carbonComponent]: "",
        [app]: 'Button(node, { kind: "ghost" });',
      });
      // Rebuild: only the Carbon module is transformed again; App.svelte is
      // unchanged, so Rollup reuses its cached transform.
      expect(await rebuild(plugin, ids, { [carbonComponent]: "" })).toEqual(
        cssContent,
      );
    });

    test("drops prop values from a module no longer in the graph", async () => {
      const plugin = resolvePlugin(optimizeCss({ silent: true }));

      await rebuild(plugin, [carbonComponent, app], {
        [carbonComponent]: "",
        [app]: 'Button(node, { kind: "ghost" });',
      });
      expect(
        await rebuild(plugin, [carbonComponent], { [carbonComponent]: "" }),
      ).toEqual(".bx--btn--primary{a:b}");
    });
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
    const app = "/app/src/App.svelte";

    // First build: Button is imported and an app module has a literal token.
    await plugin.buildStart();
    plugin.transform("", carbonComponent);
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
    plugin.transform("", carbonComponent);
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
.bx--modal { background: red }`;
    const app = "/app/src/App.svelte";
    const other = "/app/src/other.ts";

    await plugin.buildStart();
    plugin.transform("", carbonComponent);
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
.bx--modal { background: red }`;
    const app = "/app/src/App.svelte";

    await plugin.buildStart();
    plugin.transform("", carbonComponent);
    plugin.transform('const c = "bx--accordion";', app);
    await plugin.generateBundle.call(
      graphContext(carbonComponent, app),
      {},
      makeCssBundle(cssContent),
    );

    // The edit swaps `bx--accordion` for `bx--modal`.
    await plugin.buildStart();
    plugin.transform('const c = "bx--modal";', app);
    const bundle = makeCssBundle(cssContent);
    await plugin.generateBundle.call(
      graphContext(carbonComponent, app),
      {},
      bundle,
    );

    expect((bundle["styles.css"] as OutputAsset).source).toEqual(
      `.bx--btn { color: blue }
.bx--modal { background: red }`,
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
      plugin.configResolved({ root: dir, logger: quietLogger });
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
      const plugin = resolvePlugin(
        optimizeCss({ silent: true, content: ["nope/**/*.svelte"] }),
      );
      const cssContent = ".bx--btn { color: blue }";
      const ctx = { warn: jest.fn() };

      await plugin.buildStart();
      plugin.configResolved({ root: dir, logger: quietLogger });
      plugin.transform("", carbonComponent);

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
      plugin.configResolved({ root: dir, logger: quietLogger });
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
