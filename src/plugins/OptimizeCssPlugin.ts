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
import { CARBON, PROP_AWARE_FAILURE } from "../carbon-library";
import { LOG_PREFIX } from "../constants";
import { loadComponentIndex } from "../indexer/load-index";
import {
  errorMessage,
  isCarbonSvelteImport,
  isCssFile,
  isScannableModule,
} from "../utils";
import { prepareCssPruning } from "./css-pruning";
import { contentScanWarning, NO_CARBON_IMPORTS } from "./messages";
import { optimizeAssets } from "./optimize-assets";
import { type RewriteHeader, rewriteHeader } from "./rewrite-header";
import {
  type OptimizeCssOptions,
  propAwareOptions,
  sharesAnalysis,
} from "./options";
import {
  canNameTokens,
  collectTokenNames,
  collectTokenReads,
} from "./prune-tokens";
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

/** `--cds-` names in the compilation's scripts and markup. */
function assetTokenNames(
  assets: Record<string, WebpackAssetSource>,
): Set<string> {
  const names = new Set<string>();
  for (const [id, asset] of Object.entries(assets)) {
    if (canNameTokens(id)) {
      collectTokenNames(asset.source().toString(), names);
    }
  }
  return names;
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
 * Webpack/Rspack plugin that removes unused Carbon CSS from production
 * builds.
 *
 * `finishModules` collects the Carbon components in the module graph;
 * `processAssets` then splices unused rules out of the CSS assets.
 */
export class OptimizeCssPlugin {
  private options: OptimizeCssOptions;

  /** What `OptimizeComponentsPlugin` rewrote, set as it prepares each build. */
  private header: RewriteHeader;

  public constructor(options?: OptimizeCssOptions) {
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
    const propAware = propAwareOptions(options);
    const carbon = libraryPaths(CARBON);

    compiler.hooks.thisCompilation.tap(
      OptimizeCssPlugin.name,
      (compilation) => {
        const ids = new Set<string>();
        const moduleClasses = new Set<string>();
        /** `[resource, code]` of every scannable module, for `propAware`. */
        const propAwareModules: Array<[string, string]> = [];
        /** The module graph's edges into Carbon, for `propAware`. */
        const carbonImports: LibraryImport[] = [];
        const warn = (message: string) => {
          if (!silent) compilation.warnings.push(new WebpackError(message));
        };

        compilation.hooks.finishModules.tap(
          OptimizeCssPlugin.name,
          (modules) => {
            for (const module of modules) {
              const resource = module.resource;
              if (typeof resource !== "string") continue;

              if (propAware && carbon.importKey(resource)) {
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
              const scan = options.scanModules !== false;
              if (!(scan || propAware)) continue;

              const code = moduleSource(module);
              if (code !== undefined) {
                if (scan) collectCarbonTokens(code, moduleClasses);
                if (propAware) propAwareModules.push([resource, code]);
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

            const analyzer = propAware
              ? await import("svelte-prune/internal/analysis")
              : undefined;
            // `OptimizeComponentsPlugin`'s analysis, when it's in the build:
            // the same reading of the call sites it rewrote for.
            const shared =
              analyzer && propAware && sharesAnalysis(propAware)
                ? analyzer.siblingAnalysis(compiler, CARBON.name)
                : undefined;
            const { optimizer, usage } = await prepareCssPruning({
              options,
              root: compiler.context,
              components,
              ids,
              classes: [...scan.classes, ...moduleClasses],
              // svelte-prune's pruner reads custom properties in its files:
              // the token names the scripts, markup and `content` name, and
              // the other CSS assets read, as the separate token pass did.
              namedTokens: [
                ...assetTokenNames(assets),
                ...assetTokenReads(assets),
                ...scan.tokens,
              ],
              analyzer,
              shared,
              collect:
                analyzer && propAware && !shared
                  ? async () => {
                      let collector: UsageCollector | undefined;
                      try {
                        collector = analyzer.createUsageCollector(
                          CARBON,
                          compiler.context,
                          PROP_AWARE_FAILURE,
                        );
                      } catch (error) {
                        warn(
                          `${LOG_PREFIX} propAware is off for this build (${errorMessage(error)}).`,
                        );
                        return undefined;
                      }
                      for (const [resource, code] of propAwareModules) {
                        collector.add(resource, code);
                      }
                      return {
                        result: await collector.analyze(
                          ids,
                          propAware,
                          carbonImports,
                        ),
                        files: propAwareModules.map(([, code]) => ({ code })),
                      };
                    }
                  : undefined,
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
              tokenNames: [...assetTokenNames(assets), ...scan.tokens],
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
