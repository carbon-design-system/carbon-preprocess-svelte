import postcss from "postcss";
import discardEmpty from "postcss-discard-empty";
import type { Compiler } from "webpack";
import { RE_EXT_CSS } from "../constants";
import type { OptimizeCssOptions } from "./utils";
import {
  getComponentClasses,
  getCssAllowlist,
  isCarbonSvelteComponent,
  logComparison,
  postcssOptimizeCarbon,
  stringSizeInKB,
} from "./utils";

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
        const css_allowlist = getCssAllowlist();

        hooks.beforeSnapshot.tap(OptimizeCssPlugin.name, (module) => {
          if (module.buildInfo?.fileDependencies) {
            for (const id of module.buildInfo.fileDependencies) {
              if (isCarbonSvelteComponent(id)) {
                css_allowlist.push(...getComponentClasses(id));
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
            for (const [id] of Object.entries(assets)) {
              if (RE_EXT_CSS.test(id)) {
                const source = assets[id].source();
                const optimized_css = postcss([
                  postcssOptimizeCarbon({ ...this.options, css_allowlist }),
                  discardEmpty(),
                ]).process(source).css;

                const original_size = stringSizeInKB(source.toString());
                const optimized_size = stringSizeInKB(optimized_css);

                if (optimized_size < original_size) {
                  compilation.updateAsset(id, new RawSource(optimized_css));

                  if (this.options.verbose) {
                    logComparison({ original_size, optimized_size, id });
                  }
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
