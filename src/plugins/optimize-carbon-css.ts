import { setComponents } from "../component-index/registry";
import { ensureLiveComponentIndex } from "../indexer/live-index";
import {
  type OptimizeCssOptions,
  type OptimizedCssReport,
  optimizeCssWithReport,
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

  /** Directory that `content` globs resolve from. @default process.cwd() */
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
  if (options.experimental?.liveIndex) {
    const index = await ensureLiveComponentIndex();
    // Already warned; return the CSS unpruned.
    if (!index) return { css: toCssString(css), removed: 0 };
    setComponents(index);
  }

  const ids = [...options.components];
  if (ids.length === 0) {
    return { css: toCssString(css), removed: 0 };
  }

  const contentClasses = new Set(
    scanContent(options.content, options.cwd).classes,
  );
  for (const source of options.sources ?? []) {
    collectCarbonTokens(source, contentClasses);
  }

  return optimizeCssWithReport({
    source: css,
    ids,
    contentClasses,
    safelist: options.safelist,
    preserveAllIBMFonts: options.preserveAllIBMFonts,
  });
}
