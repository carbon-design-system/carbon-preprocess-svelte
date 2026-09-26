import { isBuiltin } from "node:module";
import { loadComponentIndex } from "../indexer/load-index";
import { isCarbonSvelteImport, isCssFile, isScannableModule } from "../utils";
import type { OptimizeCssOptions } from "./create-optimized-css";
import { createCssOptimizer, isSilent } from "./create-optimized-css";
import { contentScanWarning, NO_CARBON_IMPORTS } from "./messages";
import { logAssetDiff } from "./print-diff";
import type { AssetReport } from "./print-report";
import { printReport, toAssetReport } from "./print-report";
import { collectCarbonTokens, scanContent } from "./scan-content";
import {
  carbonSourceDir,
  createModulePropScanner,
  createPropUsage,
  markAllDynamic,
  mergePropUsage,
  type PropUsage,
} from "./scan-props";
import { hasOptimizableCss } from "./strict-css-optimizer";

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

type WebpackModule = {
  resource?: unknown;
  /** Set on ExternalModule (webpack and Rspack): how the import is left to the runtime. */
  externalType?: unknown;
  /** ExternalModule's request: `"fs"`, `"react"`, … */
  request?: unknown;
  /** Present on NormalModule (webpack and Rspack): the loader output for this module. */
  originalSource?: () => WebpackAssetSource | null | undefined;
};

type WebpackCompilation = {
  hooks: {
    finishModules: {
      tapPromise(
        name: string,
        callback: (modules: Iterable<WebpackModule>) => Promise<void>,
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
 * Webpack/Rspack plugin that removes unused Carbon CSS classes from production builds.
 *
 * Rspack aims for webpack plugin API compatibility, so this single plugin works
 * with both bundlers unchanged.
 *
 * The plugin operates in two phases:
 * 1. During module processing, it collects all Carbon Svelte component file paths
 *    by inspecting each module's `resource` in the `finishModules` hook, which
 *    fires once every module in the graph has resolved.
 * 2. During asset processing, it splices out CSS rules that don't match any
 *    classes used by the collected components.
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
        WebpackError,
      },
    } = compiler;
    const options = this.options;
    const silent = isSilent(options);

    compiler.hooks.thisCompilation.tap(
      OptimizeCssPlugin.name,
      (compilation) => {
        const ids = new Set<string>();
        const moduleClasses = new Set<string>();
        /** What bundled modules pass to the index's variant props. */
        let propUsage: PropUsage | undefined;
        const warn = (message: string) => {
          if (!silent) compilation.warnings.push(new WebpackError(message));
        };

        /**
         * `finishModules` fires once every module in the graph has resolved,
         * so each imported Carbon Svelte component already exists as its own
         * module with a `resource` (its resolved file path) set. The index
         * loads first: it names the props the module scan looks for.
         */
        compilation.hooks.finishModules.tapPromise(
          OptimizeCssPlugin.name,
          async (iterable) => {
            const modules = [...iterable];
            // A compiler that bundles no Carbon never needs the index; loading
            // it anyway would warn when Carbon isn't installed there.
            const components =
              options.scanModules !== false &&
              modules.some(
                ({ resource }) =>
                  typeof resource === "string" &&
                  isCarbonSvelteImport(resource),
              )
                ? await loadComponentIndex(compiler.context)
                : undefined;
            const scanProps =
              components &&
              createModulePropScanner(
                components,
                carbonSourceDir(compiler.context),
              );
            const usage = scanProps ? createPropUsage() : undefined;

            for (const module of modules) {
              // An external (`externals`, a CDN global) is imported but its
              // code isn't in the build, so it could pass any value.
              if (
                usage &&
                components &&
                typeof module.externalType === "string" &&
                !(
                  typeof module.request === "string" &&
                  isBuiltin(module.request)
                )
              ) {
                markAllDynamic(usage, components);
              }

              const resource = module.resource;
              if (typeof resource !== "string") continue;

              const isCarbon = isCarbonSvelteImport(resource);
              if (isCarbon) ids.add(resource);

              const scanTokens =
                !isCarbon &&
                options.scanModules !== false &&
                isScannableModule(resource);
              if (!scanTokens && !scanProps) continue;

              let source: string | Buffer | undefined;
              let unreadable = false;
              try {
                source = module.originalSource?.()?.source();
              } catch {
                // Some module types throw when asked for a source.
                unreadable = true;
              }
              if (typeof source !== "string" && !Buffer.isBuffer(source)) {
                // A module whose code can't be read could pass any value.
                if (unreadable && usage && components) {
                  markAllDynamic(usage, components);
                }
                continue;
              }

              const code = source.toString();
              if (scanTokens) collectCarbonTokens(code, moduleClasses);
              const moduleUsage = scanProps?.(resource, code);
              if (usage && moduleUsage) mergePropUsage(usage, moduleUsage);
            }
            propUsage = usage;
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
            const cssIds = Object.keys(assets).filter(isCssFile);

            if (ids.size === 0) {
              // Warn only when this compiler emitted Carbon CSS. A second
              // compiler in a multi-config setup that never imports Carbon
              // has nothing to prune.
              const hasCarbonCss = cssIds.some((id) =>
                hasOptimizableCss(assets[id].source().toString()),
              );
              if (hasCarbonCss) warn(NO_CARBON_IMPORTS);
              return;
            }

            const components = await loadComponentIndex(compiler.context);
            // Already warned; leave this compilation's CSS unpruned.
            if (!components) return;

            const scan = scanContent(options.content, compiler.context);
            const warning = contentScanWarning(
              options.content,
              compiler.context,
              scan,
            );
            if (warning) warn(warning);

            const contentClasses = scan.classes;
            const optimizer = createCssOptimizer({
              ...options,
              components,
              ids,
              contentClasses: [...contentClasses, ...moduleClasses],
              propUsage,
            });
            const assetReports: AssetReport[] = [];

            for (const id of cssIds) {
              const original_css = assets[id].source().toString();
              const { css: optimized_css, removed } =
                optimizer.run(original_css);

              if (!options.dryRun) {
                compilation.updateAsset(id, new RawSource(optimized_css));
              }

              if (!silent && removed > 0) {
                logAssetDiff({
                  original_css,
                  optimized_css,
                  id,
                  dryRun: options.dryRun,
                });
              }

              if (options.report) {
                assetReports.push(
                  toAssetReport(id, original_css, optimized_css, removed),
                );
              }
            }

            if (options.report) {
              printReport({
                components: optimizer.usage.components,
                allowlistSize: optimizer.usage.allowlistSize,
                variants: optimizer.usage.variants,
                gatedOff: optimizer.usage.gatedOff,
                moduleTokens: moduleClasses.size,
                contentTokens: contentClasses.length,
                safelistEntries: options.safelist?.length ?? 0,
                assets: assetReports,
                dryRun: options.dryRun,
              });
            }
          },
        );
      },
    );
  }
}
