import { globSync } from "node:fs";
import path from "node:path";
import { LOG_PREFIX } from "../constants";
import { loadComponentIndex } from "../indexer/load-index";
import { toCssString } from "../utils";
import {
  type OptimizedCssReport,
  optimizeCssWithReport,
  type PropAwareUsage,
  type PruneOptions,
} from "./create-optimized-css";
import { type OptimizeCssOptions, propAwareOptions } from "./options";
import { collectCarbonTokens, readFiles, scanContent } from "./scan-content";

type OptimizeCarbonCssOptions = PruneOptions &
  Pick<OptimizeCssOptions, "content" | "experimental"> & {
    /**
     * Carbon components used by the app, as names (`"Button"`) or paths to
     * their `.svelte` source. Classes referenced by these components are kept.
     * An empty list returns the CSS unchanged.
     */
    components: Iterable<string>;

    /**
     * Source code to scan for literal `bx--` tokens, for example the JS output
     * of your bundler. Same detection as the plugins' `scanModules`.
     */
    sources?: Iterable<string>;

    /**
     * Project directory: `content` globs resolve from it, and the installed
     * `carbon-components-svelte` is resolved from it.
     * @default process.cwd()
     */
    cwd?: string;
  };

/**
 * Bundler-agnostic entry point for the CSS optimizer, for build tools
 * without a plugin here: the caller supplies the used components directly.
 */
export async function optimizeCarbonCss(
  css: string | Uint8Array,
  options: OptimizeCarbonCssOptions,
): Promise<OptimizedCssReport> {
  const ids = [...options.components];
  const components =
    ids.length > 0 ? await loadComponentIndex(options.cwd) : undefined;
  // Without components, or if the index failed (already warned): unpruned.
  if (!components) return { css: toCssString(css), removed: 0 };

  const contentClasses = new Set(
    scanContent(options.content, options.cwd).classes,
  );
  for (const source of options.sources ?? []) {
    collectCarbonTokens(source, contentClasses);
  }

  return optimizeCssWithReport({
    source: css,
    components,
    ids,
    contentClasses,
    safelist: options.safelist,
    preserveAllIBMFonts: options.preserveAllIBMFonts,
    propAware: await analyzePropAware(options, ids),
  });
}

/**
 * `experimental.propAware` reads call sites from the `content` files, so it
 * needs them; without `content` it's skipped with a warning.
 */
async function analyzePropAware(
  options: OptimizeCarbonCssOptions,
  ids: string[],
): Promise<PropAwareUsage | undefined> {
  const propAware = propAwareOptions(options);
  if (!propAware) return undefined;
  const cwd = path.resolve(options.cwd ?? process.cwd());
  if (!options.content || options.content.length === 0) {
    console.warn(
      `${LOG_PREFIX} experimental.propAware needs \`content\` globs covering every file that renders Carbon components; CSS was pruned without it.`,
    );
    return undefined;
  }
  const { analyzeFiles } = await import("../analyzer");
  const result = await analyzeFiles({
    projectRoot: cwd,
    files: [...readFiles(globSync(options.content, { cwd }), cwd)],
    components: ids,
    options: propAware,
  });
  if (!("warning" in result)) return result;
  console.warn(result.warning);
  return undefined;
}
