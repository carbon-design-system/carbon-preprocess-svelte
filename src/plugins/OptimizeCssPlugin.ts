import type { Compiler } from "webpack";
import { isCarbonSvelteImport, isCssFile } from "../utils";
import { compareDiff } from "./compare-diff";
import type { OptimizeCssOptions } from "./utils";
import { createOptimizedCss } from "./utils";

class OptimizeCssPlugin {
  private options: OptimizeCssOptions;

  public constructor(options?: OptimizeCssOptions) {
    this.options = {
      verbose: options?.verbose !== false,
      preserveAllIBMFonts: options?.preserveAllIBMFonts === true,
    };
  }

  public apply(compiler: Compiler) {
    const { webpack } = compiler;
    const { Compilation, NormalModule } = compiler.webpack;
    const { RawSource } = webpack.sources;

    compiler.hooks.thisCompilation.tap(
      OptimizeCssPlugin.name,
      (compilation) => {
        const hooks = NormalModule.getCompilationHooks(compilation);
        const ids: string[] = [];

        hooks.beforeSnapshot.tap(OptimizeCssPlugin.name, (module) => {
          if (module.buildInfo?.fileDependencies) {
            for (const id of module.buildInfo.fileDependencies) {
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
            if (ids.length === 0) return;

            for (const [id] of Object.entries(assets)) {
              if (isCssFile(id)) {
                const original_css = assets[id].source();
                const optimized_css = createOptimizedCss(original_css, {
                  ...this.options,
                  ids,
                });

                compilation.updateAsset(id, new RawSource(optimized_css));

                if (this.options.verbose) {
                  compareDiff({ original_css, optimized_css, id });
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
