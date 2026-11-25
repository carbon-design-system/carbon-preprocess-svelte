import {
  importEdges,
  isProduction,
  type LibraryImport,
  libraryPaths,
  moduleSource,
  type WebpackConnection,
  type WebpackModule,
} from "svelte-prune/internal";
import type { UsageCollector } from "svelte-prune/internal/analysis";
import { CARBON, CSS_FAILURE } from "../carbon-library";
import { LOG_PREFIX } from "../constants";
import {
  errorMessage,
  isCarbonSvelteImport,
  isCssFile,
  isScannableModule,
} from "../utils";
import { prepareCssPruning } from "./css-pruning";
import { bundledStylesheets } from "./carbon-style-pruner";
import { contentScanWarning, NO_CARBON_IMPORTS } from "./messages";
import { optimizeAssets } from "./optimize-assets";
import { type RewriteHeader, rewriteHeader } from "./rewrite-header";
import {
  type OptimizeCssOptions,
  checkRemovedOptions,
  sharesAnalysis,
  usageOptions,
} from "./options";
import {
  canNameTokens,
  collectTokenNames,
  collectTokenReads,
} from "./token-names";
import { collectCarbonTokens, scanContent } from "./scan-content";
import { hasOptimizableCss } from "./carbon-rules";

/**
 * Structural subset of the webpack/Rspack `Compiler` and `Compilation`
 * APIs this plugin uses, so it works with either bundler without depending
 * on either package.
 */
type WebpackAssetSource = {
  source(): string | Buffer;
};

/**
 * `--cds-` names in the compilation's scripts and markup; `written` holds
 * the ones they only set or remove.
 */
function assetTokenNames(assets: Record<string, WebpackAssetSource>): {
  names: Set<string>;
  written: Set<string>;
} {
  const names = new Set<string>();
  const written = new Set<string>();
  for (const [id, asset] of Object.entries(assets)) {
    if (canNameTokens(id)) {
      collectTokenNames(asset.source().toString(), names, written);
    }
  }
  return { names, written };
}

/**
 * The tokens the app's own CSS assets read: svelte-prune's pruner sees one
 * asset at a time. Not Carbon's, which it prunes: what those read counts
 * only once their pruned rules are gone, which it checks itself.
 */
function assetTokenReads(
  assets: Record<string, WebpackAssetSource>,
): Set<string> {
  const names = new Set<string>();
  for (const [id, asset] of Object.entries(assets)) {
    if (!isCssFile(id)) continue;
    const css = asset.source().toString();
    if (!hasOptimizableCss(css)) collectTokenReads(css, names);
  }
  return names;
}

type WebpackCompilation = {
  /** Absent on the mock compilations unit tests pass. */
  moduleGraph?: {
    getIncomingConnections(module: WebpackModule): Iterable<WebpackConnection>;
  };
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
 * Webpack/Rspack plugin that removes unused Carbon CSS from
 * production builds.
 *
 * `finishModules` collects the Carbon components in the module graph;
 * `processAssets` then splices unused rules out of the CSS assets.
 */
export class OptimizeCssPlugin {
  private options: OptimizeCssOptions;

  /** What `OptimizeComponentsPlugin` rewrote, set as it prepares each build. */
  private header: RewriteHeader;

  public constructor(options?: OptimizeCssOptions) {
    checkRemovedOptions(options);
    this.options = { ...options };
    this.header = rewriteHeader(this, options?.silent === true);
  }

  public apply(compiler: WebpackCompiler) {
    if (!isProduction(compiler)) return;

    const {
      webpack: {
        Compilation,
        sources: { RawSource },
        WebpackError,
      },
    } = compiler;
    const options = this.options;
    const silent = options.silent === true;
    const carbon = libraryPaths(CARBON);

    compiler.hooks.thisCompilation.tap(
      OptimizeCssPlugin.name,
      (compilation) => {
        const ids = new Set<string>();
        const moduleClasses = new Set<string>();
        /** `[resource, code]` of every scannable module, for the analysis. */
        const analyzedModules: Array<[string, string]> = [];
        /** The module graph's edges into Carbon, for the analysis. */
        const carbonImports: LibraryImport[] = [];
        // Every module's resource, since the Carbon stylesheets among them
        // are all the pruner needs to read.
        const resources = new Set<string>();
        const warn = (message: string) => {
          if (!silent) compilation.warnings.push(new WebpackError(message));
        };

        compilation.hooks.finishModules.tap(
          OptimizeCssPlugin.name,
          (modules) => {
            for (const module of modules) {
              const resource = module.resource;
              if (typeof resource !== "string") continue;
              resources.add(resource);

              if (carbon.importKey(resource)) {
                carbonImports.push(
                  ...importEdges(
                    resource,
                    compilation.moduleGraph?.getIncomingConnections(module) ??
                      [],
                  ),
                );
              }

              if (isCarbonSvelteImport(resource)) {
                ids.add(resource);
                continue;
              }

              if (!isScannableModule(resource)) continue;
              const code = moduleSource(module);
              if (code !== undefined) {
                if (options.scanModules !== false) {
                  collectCarbonTokens(code, moduleClasses);
                }
                analyzedModules.push([resource, code]);
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

            const scan = scanContent(options.content, compiler.context);
            const warning = contentScanWarning(
              options.content,
              compiler.context,
              scan,
            );
            if (warning) warn(warning);

            const analyzer = await import("svelte-prune/internal/analysis");
            const assetTokens = assetTokenNames(assets);
            // `OptimizeComponentsPlugin`'s analysis, when it's in the build, so the
            // CSS keeps exactly what the call sites it rewrote for render.
            const shared = sharesAnalysis(options)
              ? analyzer.siblingAnalysis(compiler, CARBON.name)
              : undefined;
            const { optimizer, usage } = await prepareCssPruning({
              options,
              root: compiler.context,
              classes: [...scan.classes, ...moduleClasses],
              // svelte-prune's pruner reads custom properties in its files:
              // the token names the scripts, markup and `content` name, and
              // the other CSS assets read.
              namedTokens: [
                ...assetTokens.names,
                ...assetTokenReads(assets),
                ...scan.tokens,
              ],
              analyzer,
              stylesheets: bundledStylesheets(resources),
              shared,
              collect: shared
                ? undefined
                : async () => {
                    let collector: UsageCollector | undefined;
                    try {
                      collector = analyzer.createUsageCollector(
                        CARBON,
                        compiler.context,
                        CSS_FAILURE,
                      );
                    } catch (error) {
                      warn(
                        `${LOG_PREFIX} Carbon CSS is left unpruned in this build (${errorMessage(error)}).`,
                      );
                      return undefined;
                    }
                    for (const [resource, code] of analyzedModules) {
                      collector.add(resource, code);
                    }
                    return {
                      result: await collector.analyze(
                        ids,
                        usageOptions(options),
                        carbonImports,
                      ),
                      // What the app's modules name stays, unless
                      // `scanModules` is off.
                      files:
                        options.scanModules === false
                          ? []
                          : analyzedModules.map(([, code]) => ({ code })),
                    };
                  },
              warn,
            });

            optimizeAssets({
              assets: cssIds.map((id) => ({
                id,
                source: assets[id].source().toString(),
                write: (css) => compilation.updateAsset(id, new RawSource(css)),
              })),
              optimizer,
              options,
              rewritten: this.header.rewritten,
              moduleTokens: moduleClasses.size,
              contentTokens: scan.classes.length,
              tokenNames: [
                ...assetTokens.names,
                ...assetTokens.written,
                ...scan.tokens,
              ],
              warn,
              reportExtra: () =>
                usage?.report?.(
                  optimizer.usage.prunedByProps,
                  compiler.context,
                ) ?? [],
            });
          },
        );
      },
    );
  }
}
