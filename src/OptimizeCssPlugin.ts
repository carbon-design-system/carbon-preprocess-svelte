import path from "node:path";
import postcss from "postcss";
import discardEmpty from "postcss-discard-empty";
import type { Compiler } from "webpack";
import { components } from "./component-index";
import { CarbonSvelte, RE_EXT_CSS, RE_EXT_SVELTE } from "./constants";
import type { OptimizeCssOptions } from "./optimize-css";
import { postcssOptimizeCarbon } from "./postcss-plugin";
import { logComparison, noop, stringSizeInKB } from "./utils";

class OptimizeCssPlugin {
  private options: OptimizeCssOptions = {
    verbose: true,
    preserveAllIBMFonts: false,
    postcssPlugin: undefined,
  };

  public constructor(options?: OptimizeCssOptions) {
    if (options?.verbose === false) {
      this.options.verbose = false;
    }

    if (options?.preserveAllIBMFonts === true) {
      this.options.preserveAllIBMFonts = true;
    }

    if (options?.postcssPlugin) {
      this.options.postcssPlugin = options.postcssPlugin;
    }
  }

  private apply(compiler: Compiler) {
    const { webpack } = compiler;
    const { Compilation, NormalModule } = compiler.webpack;
    const { RawSource } = webpack.sources;

    compiler.hooks.thisCompilation.tap(
      OptimizeCssPlugin.name,
      (compilation) => {
        const css_allowlist: string[] = [".bx--body"];
        const hooks = NormalModule.getCompilationHooks(compilation);

        hooks.beforeSnapshot.tap(OptimizeCssPlugin.name, (module) => {
          if (module.buildInfo?.fileDependencies) {
            for (const id of module.buildInfo.fileDependencies) {
              if (
                RE_EXT_SVELTE.test(id) &&
                id.includes(CarbonSvelte.Components)
              ) {
                const { name } = path.parse(id);

                if (name in components) {
                  css_allowlist.push(...components[name].classes);
                }
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
                  this.options.postcssPlugin ?? noop,
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
