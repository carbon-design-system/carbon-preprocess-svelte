import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Compiler } from "webpack";
import { CarbonSvelte } from "../src/constants";
import {
  contentMatchedNothing,
  NO_CARBON_IMPORTS,
} from "../src/plugins/messages";
import OptimizeCssPlugin from "../src/plugins/OptimizeCssPlugin";

type ModuleResource =
  | string
  | { resource: string; source?: string; throwOnSource?: boolean };

// Mock webpack compiler and related types
const createMockCompiler = (
  options: {
    assets?: Record<string, unknown>;
    moduleResources?: ModuleResource[];
    mode?: "production" | "development" | "none";
    context?: string;
  } = {},
) => {
  const {
    assets = {},
    moduleResources = [],
    mode = "production",
    context = process.cwd(),
  } = options;

  let processAssetsPromise: Promise<void> | null = null;

  const compilation = {
    hooks: {
      finishModules: {
        tap: jest.fn((_, callback) => {
          callback(
            moduleResources.map((entry) => {
              if (typeof entry === "string") return { resource: entry };
              const { resource, source, throwOnSource } = entry;
              if (source === undefined && !throwOnSource) return { resource };
              return {
                resource,
                originalSource: () => {
                  if (throwOnSource) throw new Error("no source available");
                  return { source: () => source as string };
                },
              };
            }),
          );
        }),
      },
      processAssets: {
        tapPromise: jest.fn((_, callback) => {
          processAssetsPromise = callback(assets);
        }),
      },
    },
    updateAsset: jest.fn(),
    warnings: [] as Error[],
  };

  return {
    options: { mode },
    context,
    hooks: {
      thisCompilation: {
        tap: jest.fn((_, callback) => callback(compilation)),
      },
    },
    webpack: {
      Compilation: {
        PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE:
          "PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE",
      },
      sources: {
        RawSource: jest.fn((content) => ({ source: () => content })),
      },
      WebpackError: class extends Error {},
    },
    compilation,
    waitForProcessAssets: () => processAssetsPromise,
  };
};

const asCompiler = (mock: ReturnType<typeof createMockCompiler>): Compiler => {
  return mock as unknown as Compiler;
};

// `options` is a private field on OptimizeCssPlugin; tests read it directly
// to assert defaults, so the private modifier is bypassed via an unknown cast
// rather than `@ts-expect-error` on every access.
const getOptions = (plugin: OptimizeCssPlugin): unknown =>
  (plugin as unknown as { options: unknown }).options;

describe("OptimizeCssPlugin", () => {
  test("constructor sets default options correctly", () => {
    const plugin = new OptimizeCssPlugin();
    expect(getOptions(plugin)).toEqual({
      preserveAllIBMFonts: false,
    } as const);
  });

  test("constructor respects provided options", () => {
    const plugin = new OptimizeCssPlugin({
      silent: true,
      preserveAllIBMFonts: true,
      experimental: { liveIndex: true },
    });
    expect(getOptions(plugin)).toEqual({
      silent: true,
      preserveAllIBMFonts: true,
      experimental: { liveIndex: true },
    });
  });

  test("skips processing in development mode", () => {
    const plugin = new OptimizeCssPlugin();
    const mockCompiler = createMockCompiler({
      assets: { "styles.css": { source: () => ".bx--btn { color: blue; }" } },
      moduleResources: ["node_modules/carbon-components-svelte/Button.svelte"],
      mode: "development",
    });

    plugin.apply(asCompiler(mockCompiler));
    expect(mockCompiler.hooks.thisCompilation.tap).not.toHaveBeenCalled();
  });

  test("skips processing if no Carbon Svelte imports are found", () => {
    const plugin = new OptimizeCssPlugin();
    const mockCompiler = createMockCompiler({
      assets: { "styles.css": { source: () => "body { color: red; }" } },
      moduleResources: ["regular-component.svelte"],
    });

    plugin.apply(asCompiler(mockCompiler));
    expect(mockCompiler.compilation.updateAsset).not.toHaveBeenCalled();
  });

  test("warns when no Carbon component was imported", async () => {
    const plugin = new OptimizeCssPlugin();
    const mockCompiler = createMockCompiler({
      assets: { "styles.css": { source: () => ".bx--btn { color: red; }" } },
      moduleResources: [],
    });

    plugin.apply(asCompiler(mockCompiler));
    await mockCompiler.waitForProcessAssets();

    expect(mockCompiler.compilation.warnings).toHaveLength(1);
    const [warning] = mockCompiler.compilation.warnings;
    expect(warning).toBeInstanceOf(mockCompiler.webpack.WebpackError);
    expect(warning.message).toEqual(NO_CARBON_IMPORTS);
    expect(mockCompiler.compilation.updateAsset).not.toHaveBeenCalled();
  });

  test("silent suppresses the no-imports warning", async () => {
    const plugin = new OptimizeCssPlugin({ silent: true });
    const mockCompiler = createMockCompiler({
      assets: { "styles.css": { source: () => ".bx--btn { color: red; }" } },
      moduleResources: [],
    });

    plugin.apply(asCompiler(mockCompiler));
    await mockCompiler.waitForProcessAssets();

    expect(mockCompiler.compilation.warnings).toEqual([]);
  });

  test("does not warn when no asset contains Carbon CSS", async () => {
    // A second compiler in a multi-config setup that never imports Carbon
    // should not warn.
    const plugin = new OptimizeCssPlugin();
    const mockCompiler = createMockCompiler({
      assets: { "styles.css": { source: () => "body { color: red; }" } },
      moduleResources: [],
    });

    plugin.apply(asCompiler(mockCompiler));
    await mockCompiler.waitForProcessAssets();

    expect(mockCompiler.compilation.warnings).toEqual([]);
    expect(mockCompiler.compilation.updateAsset).not.toHaveBeenCalled();
  });

  test("processes CSS files when Carbon Svelte imports are found", async () => {
    const plugin = new OptimizeCssPlugin();
    const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;
    const cssContent = ".bx--btn { color: blue; }";

    const mockCompiler = createMockCompiler({
      assets: {
        "styles.css": { source: () => cssContent },
      },
      moduleResources: [carbonComponent],
    });

    plugin.apply(asCompiler(mockCompiler));
    await mockCompiler.waitForProcessAssets();
    expect(mockCompiler.compilation.warnings).toEqual([]);

    expect(mockCompiler.compilation.updateAsset).toHaveBeenCalledWith(
      "styles.css",
      expect.any(Object),
    );
  });

  test("handles Buffer input correctly", async () => {
    const plugin = new OptimizeCssPlugin();
    const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;
    const cssContent = Buffer.from(".bx--btn { color: blue; }");

    const mockCompiler = createMockCompiler({
      assets: {
        "styles.css": { source: () => cssContent },
      },
      moduleResources: [carbonComponent],
    });

    plugin.apply(asCompiler(mockCompiler));
    await mockCompiler.waitForProcessAssets();
    expect(mockCompiler.compilation.warnings).toEqual([]);

    expect(mockCompiler.compilation.updateAsset).toHaveBeenCalledWith(
      "styles.css",
      expect.any(Object),
    );
  });

  test("respects silent option for printing diff", async () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();
    const plugin = new OptimizeCssPlugin({ silent: false });
    const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;
    // CSS must shrink after optimization or printDiff skips logging (same kB)
    const cssWithUnusedCarbon = `* { box-sizing: border-box }
.bx--btn { color: blue }
.bx--accordion { background: yellow }`;

    const mockCompiler = createMockCompiler({
      assets: {
        "styles.css": { source: () => cssWithUnusedCarbon },
      },
      moduleResources: [carbonComponent],
    });

    plugin.apply(asCompiler(mockCompiler));
    await mockCompiler.waitForProcessAssets();
    expect(mockCompiler.compilation.warnings).toEqual([]);

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test("skips diff logging when nothing is removed", async () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();
    const plugin = new OptimizeCssPlugin({ silent: false });
    const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;
    // Button is imported and .bx--btn is the only Carbon class, so nothing is
    // pruned even though Carbon imports exist (e.g. a secondary stylesheet).
    const cssWithOnlyUsedCarbon = `* { box-sizing: border-box }
.bx--btn { color: blue }`;

    const mockCompiler = createMockCompiler({
      assets: {
        "styles.css": { source: () => cssWithOnlyUsedCarbon },
      },
      moduleResources: [carbonComponent],
    });

    plugin.apply(asCompiler(mockCompiler));
    await mockCompiler.waitForProcessAssets();
    expect(mockCompiler.compilation.warnings).toEqual([]);

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test("prunes legacy single-hyphen Carbon selectors by default", async () => {
    const plugin = new OptimizeCssPlugin({ silent: true });
    const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;
    const cssContent = `.bx--btn { color: blue }
.bx-slider-text-input { appearance: textfield }`;

    const mockCompiler = createMockCompiler({
      assets: {
        "styles.css": { source: () => cssContent },
      },
      moduleResources: [carbonComponent],
    });

    plugin.apply(asCompiler(mockCompiler));
    await mockCompiler.waitForProcessAssets();
    expect(mockCompiler.compilation.warnings).toEqual([]);

    const [, asset] = mockCompiler.compilation.updateAsset.mock.calls[0];
    expect(asset.source()).toEqual(".bx--btn { color: blue }");
  });

  test("keeps literal bx-- classes found in app modules", async () => {
    const plugin = new OptimizeCssPlugin({ silent: true });
    const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }
.bx--modal { background: red }`;

    const mockCompiler = createMockCompiler({
      assets: { "styles.css": { source: () => cssContent } },
      moduleResources: [
        carbonComponent,
        {
          resource: "/app/src/App.js",
          source: 'const c = "bx--accordion";',
        },
      ],
    });

    plugin.apply(asCompiler(mockCompiler));
    await mockCompiler.waitForProcessAssets();
    expect(mockCompiler.compilation.warnings).toEqual([]);

    const [, asset] = mockCompiler.compilation.updateAsset.mock.calls[0];
    expect(asset.source()).toEqual(
      `.bx--btn { color: blue }
.bx--accordion { background: yellow }`,
    );
  });

  test("content globs resolve from compiler.context", async () => {
    const dir = mkdtempSync(join(tmpdir(), "optimize-css-plugin-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(
        join(dir, "src", "App.svelte"),
        '<div class="bx--accordion"></div>',
      );

      const plugin = new OptimizeCssPlugin({
        silent: true,
        content: ["src/**/*.svelte"],
      });
      const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;
      const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }
.bx--modal { background: red }`;

      const mockCompiler = createMockCompiler({
        assets: { "styles.css": { source: () => cssContent } },
        moduleResources: [carbonComponent],
        context: dir,
      });

      plugin.apply(asCompiler(mockCompiler));
      await mockCompiler.waitForProcessAssets();
      expect(mockCompiler.compilation.warnings).toEqual([]);

      const [, asset] = mockCompiler.compilation.updateAsset.mock.calls[0];
      expect(asset.source()).toEqual(
        `.bx--btn { color: blue }
.bx--accordion { background: yellow }`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("scanModules: false ignores app modules", async () => {
    const plugin = new OptimizeCssPlugin({ silent: true, scanModules: false });
    const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;

    const mockCompiler = createMockCompiler({
      assets: { "styles.css": { source: () => cssContent } },
      moduleResources: [
        carbonComponent,
        {
          resource: "/app/src/App.js",
          source: 'const c = "bx--accordion";',
        },
      ],
    });

    plugin.apply(asCompiler(mockCompiler));
    await mockCompiler.waitForProcessAssets();
    expect(mockCompiler.compilation.warnings).toEqual([]);

    const [, asset] = mockCompiler.compilation.updateAsset.mock.calls[0];
    expect(asset.source()).toEqual(".bx--btn { color: blue }");
  });

  test("does not scan CSS modules, virtual modules, or Carbon's own sources", async () => {
    const plugin = new OptimizeCssPlugin({ silent: true });
    const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;

    const mockCompiler = createMockCompiler({
      assets: { "styles.css": { source: () => cssContent } },
      moduleResources: [
        carbonComponent,
        { resource: "/app/styles.css", source: "bx--accordion" },
        { resource: "\0virtual:thing", source: "bx--accordion" },
        {
          resource: `node_modules/${CarbonSvelte.Components}/src/utils/x.js`,
          source: "bx--accordion",
        },
      ],
    });

    plugin.apply(asCompiler(mockCompiler));
    await mockCompiler.waitForProcessAssets();
    expect(mockCompiler.compilation.warnings).toEqual([]);

    const [, asset] = mockCompiler.compilation.updateAsset.mock.calls[0];
    expect(asset.source()).toEqual(".bx--btn { color: blue }");
  });

  test("ignores a module whose originalSource() throws", async () => {
    const plugin = new OptimizeCssPlugin({ silent: true });
    const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;
    const cssContent = ".bx--btn { color: blue }";

    const mockCompiler = createMockCompiler({
      assets: { "styles.css": { source: () => cssContent } },
      moduleResources: [
        carbonComponent,
        { resource: "/app/src/Broken.js", throwOnSource: true },
      ],
    });

    plugin.apply(asCompiler(mockCompiler));
    await expect(mockCompiler.waitForProcessAssets()).resolves.toBeUndefined();
    expect(mockCompiler.compilation.warnings).toEqual([]);

    expect(mockCompiler.compilation.updateAsset).toHaveBeenCalled();
  });

  test("dryRun does not call updateAsset", async () => {
    const plugin = new OptimizeCssPlugin({ dryRun: true, silent: true });
    const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;
    const cssContent =
      ".bx--btn { color: blue }\n.bx--accordion { background: yellow }";

    const mockCompiler = createMockCompiler({
      assets: { "styles.css": { source: () => cssContent } },
      moduleResources: [carbonComponent],
    });

    plugin.apply(asCompiler(mockCompiler));
    await mockCompiler.waitForProcessAssets();
    expect(mockCompiler.compilation.warnings).toEqual([]);

    expect(mockCompiler.compilation.updateAsset).not.toHaveBeenCalled();
  });

  test("report prints detected components and assets", async () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const plugin = new OptimizeCssPlugin({ report: true, silent: true });
    const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }
.bx--modal { background: red }`;

    const mockCompiler = createMockCompiler({
      assets: { "styles.css": { source: () => cssContent } },
      moduleResources: [
        carbonComponent,
        { resource: "/app/src/App.js", source: 'const c = "bx--accordion";' },
      ],
    });

    plugin.apply(asCompiler(mockCompiler));
    await mockCompiler.waitForProcessAssets();

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

  test("warns when content globs match nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "optimize-css-plugin-"));
    try {
      const plugin = new OptimizeCssPlugin({ content: ["nope/**/*.svelte"] });
      const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;
      const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;

      const mockCompiler = createMockCompiler({
        assets: { "styles.css": { source: () => cssContent } },
        moduleResources: [carbonComponent],
        context: dir,
      });

      plugin.apply(asCompiler(mockCompiler));
      await mockCompiler.waitForProcessAssets();

      expect(mockCompiler.compilation.warnings).toHaveLength(1);
      const [warning] = mockCompiler.compilation.warnings;
      expect(warning).toBeInstanceOf(mockCompiler.webpack.WebpackError);
      expect(warning.message).toEqual(
        contentMatchedNothing(["nope/**/*.svelte"], dir),
      );

      const [, asset] = mockCompiler.compilation.updateAsset.mock.calls[0];
      expect(asset.source()).toEqual(".bx--btn { color: blue }");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("silent suppresses the content-globs-matched-nothing warning", async () => {
    const dir = mkdtempSync(join(tmpdir(), "optimize-css-plugin-"));
    try {
      const plugin = new OptimizeCssPlugin({
        silent: true,
        content: ["nope/**/*.svelte"],
      });
      const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;
      const cssContent = ".bx--btn { color: blue }";

      const mockCompiler = createMockCompiler({
        assets: { "styles.css": { source: () => cssContent } },
        moduleResources: [carbonComponent],
        context: dir,
      });

      plugin.apply(asCompiler(mockCompiler));
      await mockCompiler.waitForProcessAssets();

      expect(mockCompiler.compilation.warnings).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("does not warn when content globs match", async () => {
    const dir = mkdtempSync(join(tmpdir(), "optimize-css-plugin-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(
        join(dir, "src", "App.svelte"),
        '<div class="bx--accordion"></div>',
      );

      const plugin = new OptimizeCssPlugin({ content: ["src/**/*.svelte"] });
      const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;
      const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;

      const mockCompiler = createMockCompiler({
        assets: { "styles.css": { source: () => cssContent } },
        moduleResources: [carbonComponent],
        context: dir,
      });

      plugin.apply(asCompiler(mockCompiler));
      await mockCompiler.waitForProcessAssets();

      expect(mockCompiler.compilation.warnings).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
