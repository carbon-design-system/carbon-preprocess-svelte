import { setComponents } from "../component-index-registry";
import { ensureLiveComponentIndex } from "../indexer/live-index";
import { isCarbonSvelteImport, isCssFile } from "../utils";
import type { OptimizeCssOptions } from "./create-optimized-css";
import { createCssOptimizer, isSilent } from "./create-optimized-css";
import { printDiff } from "./print-diff";
import { scanContentClasses } from "./scan-content";

/**
 * Structural subset of the webpack/Rspack `Compiler` and `Compilation` APIs
 * used by this plugin. Rspack's compiler exposes the same `compiler.webpack`
 * namespace (`Compilation`, `sources`, etc.) for plugin compatibility, so
 * typing against this shape—rather than importing from the `webpack`
 * package—lets the same plugin instance be used with either bundler without
 * adding a dependency on either one.
 */
type WebpackAssetSource = {
  source(): string | Buffer;
};

type WebpackCompilation = {
  hooks: {
    finishModules: {
      tap(name: string, callback: (modules: Iterable<unknown>) => void): void;
    };
    processAssets: {
      tapPromise(
        options: { name: string; stage: number },
        callback: (assets: Record<string, WebpackAssetSource>) => Promise<void>,
      ): void;
    };
  };
  updateAsset(name: string, source: unknown): void;
};

type WebpackCompiler = {
  options: { mode?: string };
  webpack: {
    Compilation: { PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE: number };
    sources: { RawSource: new (source: string) => unknown };
  };
  hooks: {
    thisCompilation: {
      tap(
        name: string,
        callback: (compilation: WebpackCompilation) => void,
      ): void;
    };
  };
};

/**
 * Webpack/Rspack plugin that removes unused Carbon CSS classes from production builds.
 *
 * Rspack aims for webpack plugin API compatibility, so this single plugin works
 * with both bundlers unchanged.
 *
 * The plugin operates in two phases:
 * 1. During module processing, it collects all Carbon Svelte component file paths
 *    by inspecting each module's `resource` in the `finishModules` hook, which
 *    fires once every module in the graph has resolved.
 * 2. During asset processing, it uses PostCSS to strip CSS rules that don't match
 *    any classes used by the collected components.
 *
 * This can dramatically reduce CSS bundle size since Carbon's full stylesheet
 * includes styles for all components, but apps typically use only a subset.
 */
export default class OptimizeCssPlugin {
  private options: OptimizeCssOptions;

  public constructor(options?: OptimizeCssOptions) {
    this.options = {
      preserveAllIBMFonts: false,
      ...options,
    };
  }

  public apply(compiler: WebpackCompiler) {
    if (compiler.options.mode !== "production") {
      return;
    }

    const {
      webpack: {
        Compilation,
        sources: { RawSource },
      },
    } = compiler;

    compiler.hooks.thisCompilation.tap(
      OptimizeCssPlugin.name,
      (compilation) => {
        const ids = new Set<string>();

        /**
         * `finishModules` fires once every module in the graph has resolved,
         * so each imported Carbon Svelte component already exists as its own
         * module with a `resource` (its resolved file path) set.
         */
        compilation.hooks.finishModules.tap(
          OptimizeCssPlugin.name,
          (modules) => {
            for (const module of modules) {
              const resource = (module as { resource?: unknown }).resource;
              if (
                typeof resource === "string" &&
                isCarbonSvelteImport(resource)
              ) {
                ids.add(resource);
              }
            }
          },
        );

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

            if (this.options.experimental?.liveIndex) {
              setComponents(await ensureLiveComponentIndex());
            }

            const contentClasses = scanContentClasses(this.options.content);
            const optimizer = createCssOptimizer({
              ...this.options,
              ids,
              contentClasses,
            });

            for (const id of Object.keys(assets).filter(isCssFile)) {
              const original_css = assets[id].source();
              const { css: optimized_css, removed } = optimizer.run(
                Buffer.isBuffer(original_css)
                  ? original_css.toString()
                  : original_css,
                id,
              );

              compilation.updateAsset(id, new RawSource(optimized_css));

              if (!isSilent(this.options) && removed > 0) {
                printDiff({ original_css, optimized_css, id });
              }
            }
          },
        );
      },
    );
  }
}
