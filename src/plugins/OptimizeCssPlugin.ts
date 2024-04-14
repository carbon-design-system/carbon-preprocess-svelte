import type { Compiler } from "webpack";
import { isCarbonSvelteImport, isCssFile } from "../utils";
import type { OptimizeCssOptions } from "./create-optimized-css";
import { createOptimizedCss } from "./create-optimized-css";
import { printDiff } from "./print-diff";

// Webpack plugin to optimize CSS for Carbon Svelte components.
class OptimizeCssPlugin {
  private options: OptimizeCssOptions;

  public constructor(options?: OptimizeCssOptions) {
    this.options = {
      verbose: options?.verbose !== false,
      preserveAllIBMFonts: options?.preserveAllIBMFonts === true,
    };
  }

  public apply(compiler: Compiler) {
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
        const ids: string[] = [];

        hooks.beforeSnapshot.tap(OptimizeCssPlugin.name, ({ buildInfo }) => {
          if (buildInfo?.fileDependencies) {
            for (const id of buildInfo.fileDependencies) {
              if (isCarbonSvelteImport(id)) {
                ids.push(id);
              }
            }
          }
        });

        compilation.hooks.processAssets.tap(
          {
            name: OptimizeCssPlugin.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_DERIVED,
          },
          (assets) => {
            // Skip processing if no Carbon Svelte imports are found.
            if (ids.length === 0) return;

            for (const [id] of Object.entries(assets)) {
              if (isCssFile(id)) {
                const original_css = assets[id].source();
                const optimized_css = createOptimizedCss({
                  ...this.options,
                  source: original_css,
                  ids,
                });

                compilation.updateAsset(id, new RawSource(optimized_css));

                if (this.options.verbose) {
                  printDiff({ original_css, optimized_css, id });
                }
              }
            }
          },
        );
      },
    );
  }
}

export default OptimizeCssPlugin;
