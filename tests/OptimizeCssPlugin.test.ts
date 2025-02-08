import { CarbonSvelte } from "../src/constants";
import OptimizeCssPlugin from "../src/plugins/OptimizeCssPlugin";

// Mock webpack compiler and related types
const createMockCompiler = (options: any = {}) => {
  const { assets = {}, fileDependencies = [] } = options;

  const compilation = {
    hooks: {
      processAssets: {
        tap: jest.fn((_, callback) => {
          callback(assets);
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
    hooks: {
      thisCompilation: {
        tap: jest.fn((_, callback) => callback(compilation)),
      },
    },
    webpack: {
      Compilation: {
        PROCESS_ASSETS_STAGE_DERIVED: "PROCESS_ASSETS_STAGE_DERIVED",
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
  };
};

describe("OptimizeCssPlugin", () => {
  test("constructor sets default options correctly", () => {
    const plugin = new OptimizeCssPlugin();
    expect((plugin as any).options).toEqual({
      verbose: true,
      preserveAllIBMFonts: false,
    });
  });

  test("constructor respects provided options", () => {
    const plugin = new OptimizeCssPlugin({
      verbose: false,
      preserveAllIBMFonts: true,
    });
    expect((plugin as any).options).toEqual({
      verbose: false,
      preserveAllIBMFonts: true,
    });
  });

  test("skips processing if no Carbon Svelte imports are found", () => {
    const plugin = new OptimizeCssPlugin();
    const mockCompiler = createMockCompiler({
      assets: { "styles.css": { source: () => "body { color: red; }" } },
      fileDependencies: ["regular-component.svelte"],
    });

    plugin.apply(mockCompiler as any);

    expect(mockCompiler.compilation.updateAsset).not.toHaveBeenCalled();
  });

  test("processes CSS files when Carbon Svelte imports are found", () => {
    const plugin = new OptimizeCssPlugin();
    const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;
    const cssContent = ".bx--btn { color: blue; }";

    const mockCompiler = createMockCompiler({
      assets: {
        "styles.css": { source: () => cssContent },
      },
      fileDependencies: [carbonComponent],
    });

    plugin.apply(mockCompiler as any);

    expect(mockCompiler.compilation.updateAsset).toHaveBeenCalledWith(
      "styles.css",
      expect.any(Object),
    );
  });

  test("handles Buffer input correctly", () => {
    const plugin = new OptimizeCssPlugin();
    const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;
    const cssContent = Buffer.from(".bx--btn { color: blue; }");

    const mockCompiler = createMockCompiler({
      assets: {
        "styles.css": { source: () => cssContent },
      },
      fileDependencies: [carbonComponent],
    });

    plugin.apply(mockCompiler as any);

    expect(mockCompiler.compilation.updateAsset).toHaveBeenCalledWith(
      "styles.css",
      expect.any(Object),
    );
  });

  test("respects verbose option for printing diff", () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();
    const plugin = new OptimizeCssPlugin({ verbose: true });
    const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;

    const mockCompiler = createMockCompiler({
      assets: {
        "styles.css": { source: () => ".bx--btn { color: blue; }" },
      },
      fileDependencies: [carbonComponent],
    });

    plugin.apply(mockCompiler as any);

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
