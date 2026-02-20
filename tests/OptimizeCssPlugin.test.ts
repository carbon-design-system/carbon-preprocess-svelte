import type { Compiler } from "webpack";
import { CarbonSvelte } from "../src/constants";
import OptimizeCssPlugin from "../src/plugins/OptimizeCssPlugin";

// Mock webpack compiler and related types
const createMockCompiler = (
  options: {
    assets?: Record<string, unknown>;
    fileDependencies?: string[];
    mode?: "production" | "development" | "none";
  } = {},
) => {
  const { assets = {}, fileDependencies = [], mode = "production" } = options;

  let processAssetsPromise: Promise<void> | null = null;

  const compilation = {
    hooks: {
      processAssets: {
        tapPromise: jest.fn((_, callback) => {
          processAssetsPromise = callback(assets);
        }),
      },
    },
    updateAsset: jest.fn(),
  };

  const normalModuleHooks = {
    beforeSnapshot: {
      tap: jest.fn((_, callback) => {
        callback({ buildInfo: { fileDependencies } });
      }),
    },
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
      NormalModule: {
        getCompilationHooks: () => normalModuleHooks,
      },
      sources: {
        RawSource: jest.fn((content) => ({ source: () => content })),
      },
    },
    compilation,
    normalModuleHooks,
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
    });
    // @ts-expect-error – options is private
    expect(plugin.options).toEqual({
      silent: true,
      preserveAllIBMFonts: true,
    });
  });

  test("skips processing in development mode", () => {
    const plugin = new OptimizeCssPlugin();
    const mockCompiler = createMockCompiler({
      assets: { "styles.css": { source: () => ".bx--btn { color: blue; }" } },
      fileDependencies: ["node_modules/carbon-components-svelte/Button.svelte"],
      mode: "development",
    });

    plugin.apply(asCompiler(mockCompiler));
    expect(mockCompiler.hooks.thisCompilation.tap).not.toHaveBeenCalled();
  });

  test("skips processing if no Carbon Svelte imports are found", () => {
    const plugin = new OptimizeCssPlugin();
    const mockCompiler = createMockCompiler({
      assets: { "styles.css": { source: () => "body { color: red; }" } },
      fileDependencies: ["regular-component.svelte"],
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
      fileDependencies: [carbonComponent],
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
      fileDependencies: [carbonComponent],
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

    const mockCompiler = createMockCompiler({
      assets: {
        "styles.css": { source: () => ".bx--btn { color: blue; }" },
      },
      fileDependencies: [carbonComponent],
    });

    plugin.apply(asCompiler(mockCompiler));
    await mockCompiler.waitForProcessAssets();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
