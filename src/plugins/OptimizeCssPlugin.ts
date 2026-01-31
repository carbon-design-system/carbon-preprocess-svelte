import type { Compiler } from "webpack";
import { isCarbonSvelteImport, isCssFile } from "../utils";
import type { OptimizeCssOptions } from "./create-optimized-css";
import { createOptimizedCssAsync } from "./create-optimized-css";
import { printDiff } from "./print-diff";

// Webpack plugin to optimize CSS for Carbon Svelte components.
class OptimizeCssPlugin {
  private options: OptimizeCssOptions;

  public constructor(options?: OptimizeCssOptions) {
    this.options = {
      verbose: true,
      preserveAllIBMFonts: false,
      ...options,
    };
  }

  public apply(compiler: Compiler) {
    if (compiler.options.mode !== "production") {
      return;
    }

    const {
      webpack: {
        Compilation,
        NormalModule,
        sources: { RawSource },
      },
    } = compiler;

    compiler.hooks.thisCompilation.tap(
      OptimizeCssPlugin.name,
      (compilation) => {
        const hooks = NormalModule.getCompilationHooks(compilation);
        const ids = new Set<string>();

        hooks.beforeSnapshot.tap(OptimizeCssPlugin.name, ({ buildInfo }) => {
          if (buildInfo?.fileDependencies) {
            for (const id of buildInfo.fileDependencies) {
              if (isCarbonSvelteImport(id)) {
                ids.add(id);
              }
            }
          }
        });

        compilation.hooks.processAssets.tapPromise(
          {
            name: OptimizeCssPlugin.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE,
          },
          async (assets) => {
            // Skip processing if no Carbon Svelte imports are found.
            if (ids.size === 0) return;

            const cssAssetIds = Object.keys(assets).filter(isCssFile);

            const results = await Promise.all(
              cssAssetIds.map(async (id) => {
                const original_css = assets[id].source();
                const optimized_css = await createOptimizedCssAsync({
                  ...this.options,
                  source: Buffer.isBuffer(original_css)
                    ? original_css.toString()
                    : original_css,
                  ids,
                });
                return { id, original_css, optimized_css };
              }),
            );

            for (const { id, original_css, optimized_css } of results) {
              compilation.updateAsset(id, new RawSource(optimized_css));

              if (this.options.verbose) {
                printDiff({ original_css, optimized_css, id });
              }
            }
          },
        );
      },
    );
  }
}

export default OptimizeCssPlugin;
