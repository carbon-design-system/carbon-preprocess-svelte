import { loadComponentIndex } from "../indexer/load-index";
import { isCarbonSvelteImport, isCssFile, isScannableModule } from "../utils";
import { createCssOptimizer } from "./create-optimized-css";
import { contentScanWarning, NO_CARBON_IMPORTS } from "./messages";
import { optimizeAssets } from "./optimize-assets";
import type { OptimizeCssOptions } from "./options";
import { collectCarbonTokens, scanContent } from "./scan-content";
import { hasOptimizableCss } from "./strict-css-optimizer";

/**
 * Structural subset of the webpack/Rspack `Compiler` and `Compilation` APIs
 * this plugin uses, so it works with either bundler without depending on
 * either package.
 */
type WebpackAssetSource = {
  source(): string | Buffer;
};

type WebpackModule = {
  resource?: unknown;
  /** On `NormalModule`: the loader output. */
  originalSource?: () => WebpackAssetSource | null | undefined;
};

type WebpackCompilation = {
  hooks: {
    finishModules: {
      tap(
        name: string,
        callback: (modules: Iterable<WebpackModule>) => void,
      ): void;
    };
    processAssets: {
      tapPromise(
        options: { name: string; stage: number },
        callback: (assets: Record<string, WebpackAssetSource>) => Promise<void>,
      ): void;
    };
  };
  updateAsset(name: string, source: unknown): void;
  warnings: { push(error: Error): void };
};

type WebpackCompiler = {
  options: { mode?: string };
  context: string;
  webpack: {
    Compilation: { PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE: number };
    sources: { RawSource: new (source: string) => unknown };
    WebpackError: new (message: string) => Error;
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
 * Webpack/Rspack plugin that removes unused Carbon CSS from production
 * builds.
 *
 * `finishModules` collects the Carbon components in the module graph;
 * `processAssets` then splices unused rules out of the CSS assets.
 */
export class OptimizeCssPlugin {
  private options: OptimizeCssOptions;

  public constructor(options?: OptimizeCssOptions) {
    this.options = { ...options };
  }

  public apply(compiler: WebpackCompiler) {
    if (compiler.options.mode !== "production") return;

    const {
      webpack: {
        Compilation,
        sources: { RawSource },
        WebpackError,
      },
    } = compiler;
    const options = this.options;
    const silent = options.silent === true;

    compiler.hooks.thisCompilation.tap(
      OptimizeCssPlugin.name,
      (compilation) => {
        const ids = new Set<string>();
        const moduleClasses = new Set<string>();
        const warn = (message: string) => {
          if (!silent) compilation.warnings.push(new WebpackError(message));
        };

        compilation.hooks.finishModules.tap(
          OptimizeCssPlugin.name,
          (modules) => {
            for (const module of modules) {
              const resource = module.resource;
              if (typeof resource !== "string") continue;

              if (isCarbonSvelteImport(resource)) {
                ids.add(resource);
                continue;
              }

              if (
                options.scanModules !== false &&
                isScannableModule(resource)
              ) {
                let source: string | Buffer | undefined;
                try {
                  source = module.originalSource?.()?.source();
                } catch {
                  // Some module types throw when asked for a source.
                }
                if (typeof source === "string" || Buffer.isBuffer(source)) {
                  collectCarbonTokens(source.toString(), moduleClasses);
                }
              }
            }
          },
        );

        // OPTIMIZE_SIZE runs after CSS extraction and before minification, so
        // a minifier never sees the unused rules.
        compilation.hooks.processAssets.tapPromise(
          {
            name: OptimizeCssPlugin.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE,
          },
          async (assets) => {
            const cssIds = Object.keys(assets).filter(isCssFile);

            if (ids.size === 0) {
              // A second compiler that never imports Carbon has nothing to prune.
              const hasCarbonCss = cssIds.some((id) =>
                hasOptimizableCss(assets[id].source().toString()),
              );
              if (hasCarbonCss) warn(NO_CARBON_IMPORTS);
              return;
            }

            const components = await loadComponentIndex(compiler.context);
            // `loadComponentIndex` already warned.
            if (!components) return;

            const scan = scanContent(options.content, compiler.context);
            const warning = contentScanWarning(
              options.content,
              compiler.context,
              scan,
            );
            if (warning) warn(warning);

            optimizeAssets({
              assets: cssIds.map((id) => ({
                id,
                source: assets[id].source().toString(),
                write: (css) => compilation.updateAsset(id, new RawSource(css)),
              })),
              optimizer: createCssOptimizer({
                ...options,
                components,
                ids,
                contentClasses: [...scan.classes, ...moduleClasses],
              }),
              options,
              moduleTokens: moduleClasses.size,
              contentTokens: scan.classes.length,
            });
          },
        );
      },
    );
  }
}
