import type { Compiler } from "webpack";
import { CarbonSvelte } from "../src/constants";
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
  } = {},
) => {
  const { assets = {}, moduleResources = [], mode = "production" } = options;

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
  };

  return {
    options: { mode },
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
    },
    compilation,
    waitForProcessAssets: () => processAssetsPromise,
  };
};

const asCompiler = (mock: ReturnType<typeof createMockCompiler>): Compiler => {
  return mock as unknown as Compiler;
};

describe("OptimizeCssPlugin", () => {
  test("constructor sets default options correctly", () => {
    const plugin = new OptimizeCssPlugin();
    // @ts-expect-error – options is private
    expect(plugin.options).toEqual({
      preserveAllIBMFonts: false,
    } as const);
  });

  test("constructor respects provided options", () => {
    const plugin = new OptimizeCssPlugin({
      silent: true,
      preserveAllIBMFonts: true,
      experimental: { liveIndex: true },
    });
    // @ts-expect-error – options is private
    expect(plugin.options).toEqual({
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

    const [, asset] = mockCompiler.compilation.updateAsset.mock.calls[0];
    expect(asset.source()).toEqual(
      `.bx--btn { color: blue }
.bx--accordion { background: yellow }`,
    );
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

    expect(mockCompiler.compilation.updateAsset).toHaveBeenCalled();
  });
});
