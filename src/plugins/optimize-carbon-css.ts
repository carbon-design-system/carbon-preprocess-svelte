import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadComponentIndex } from "../indexer/load-index";
import {
  type OptimizeCssOptions,
  type OptimizedCssReport,
  optimizeCssWithReport,
  type PropAwareUsage,
  propAwareOptions,
  toCssString,
} from "./create-optimized-css";
import { collectCarbonTokens, scanContent } from "./scan-content";

type OptimizeCarbonCssOptions = Pick<
  OptimizeCssOptions,
  "safelist" | "content" | "preserveAllIBMFonts" | "experimental"
> & {
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
 * Bundler-agnostic entry point for the CSS optimizer. `optimizeCss` (Vite)
 * and `OptimizeCssPlugin` (Webpack/Rspack) are thin adapters over this same
 * core: they collect `ids`/`contentClasses` from bundler hooks and call
 * `optimizeCssWithReport`. This function does the same job for any other
 * build tool, with the caller supplying the used components directly.
 */
export async function optimizeCarbonCss(
  css: string | Uint8Array,
  options: OptimizeCarbonCssOptions,
): Promise<OptimizedCssReport> {
  const ids = [...options.components];
  if (ids.length === 0) {
    return { css: toCssString(css), removed: 0 };
  }

  const components = await loadComponentIndex(options.cwd);
  // Already warned; return the CSS unpruned.
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
      "carbon-preprocess-svelte: experimental.propAware needs `content` globs covering every file that renders Carbon components; CSS was pruned without it.",
    );
    return undefined;
  }
  const files: Array<{ file: string; code: string }> = [];
  for (const file of globSync(options.content, { cwd })) {
    const absolute = path.resolve(cwd, file);
    try {
      files.push({ file: absolute, code: readFileSync(absolute, "utf8") });
    } catch {
      // A directory, or gone since the glob ran.
    }
  }
  const { analyzeFiles } = await import("../analyzer");
  const result = await analyzeFiles({
    projectRoot: cwd,
    files,
    components: ids,
    options: propAware,
  });
  if (!("warning" in result)) return result;
  console.warn(result.warning);
  return undefined;
}
