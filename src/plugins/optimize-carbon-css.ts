import { loadComponentIndex } from "../indexer/load-index";
import {
  type OptimizeCssOptions,
  type OptimizedCssReport,
  optimizeCssWithReport,
  toCssString,
} from "./create-optimized-css";
import { collectCarbonTokens, scanContent } from "./scan-content";

type OptimizeCarbonCssOptions = Pick<
  OptimizeCssOptions,
  "safelist" | "content" | "preserveAllIBMFonts"
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
  });
}
