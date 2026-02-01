import type { Compiler } from "webpack";
import { isCarbonSvelteImport, isCssFile } from "../utils";
import type { OptimizeCssOptions } from "./create-optimized-css";
import { createOptimizedCssAsync } from "./create-optimized-css";
import { printDiff } from "./print-diff";

/**
 * Webpack plugin that removes unused Carbon CSS classes from production builds.
 *
 * The plugin operates in two phases:
 * 1. During module processing, it collects all Carbon Svelte component file paths
 *    by inspecting each module's file dependencies in the `beforeSnapshot` hook.
 * 2. During asset processing, it uses PostCSS to strip CSS rules that don't match
 *    any classes used by the collected components.
 *
 * This can dramatically reduce CSS bundle size since Carbon's full stylesheet
 * includes styles for all components, but apps typically use only a subset.
 */
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

        /**
         * The `beforeSnapshot` hook fires after a module is built but before
         * its snapshot is taken for caching. At this point, `buildInfo.fileDependencies`
         * contains all files the module depends on, which includes imported Svelte components.
         * Filter these to find Carbon component paths for the allowlist.
         */
        hooks.beforeSnapshot.tap(OptimizeCssPlugin.name, ({ buildInfo }) => {
          if (buildInfo?.fileDependencies) {
            for (const id of buildInfo.fileDependencies) {
              if (isCarbonSvelteImport(id)) {
                ids.add(id);
              }
            }
          }
        });

        /**
         * Process assets at OPTIMIZE_SIZE stage, which runs after the CSS has been
         * extracted and concatenated but before final minification. This ensures
         * that unused rules are removed before any minifier further processes the CSS.
         */
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
                const start = performance.now();
                const optimized_css = await createOptimizedCssAsync({
                  ...this.options,
                  source: Buffer.isBuffer(original_css)
                    ? original_css.toString()
                    : original_css,
                  ids,
                });
                const elapsed_ms = performance.now() - start;
                return { id, original_css, optimized_css, elapsed_ms };
              }),
            );

            for (const {
              id,
              original_css,
              optimized_css,
              elapsed_ms,
            } of results) {
              compilation.updateAsset(id, new RawSource(optimized_css));

              if (this.options.verbose) {
                printDiff({ original_css, optimized_css, id, elapsed_ms });
              }
            }
          },
        );
      },
    );
  }
}

export default OptimizeCssPlugin;
