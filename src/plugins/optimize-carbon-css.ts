import { setComponents } from "../component-index-registry";
import { ensureLiveComponentIndex } from "../indexer/live-index";
import {
  type OptimizeCssOptions,
  type OptimizedCssReport,
  optimizeCssWithReport,
  toCssString,
} from "./create-optimized-css";
import { collectCarbonTokens, scanContentClasses } from "./scan-content";

/**
 * Bundler-agnostic entry point for the CSS optimizer. `optimizeCss` (Vite)
 * and `OptimizeCssPlugin` (Webpack/Rspack) are thin adapters over this same
 * core: they collect `ids`/`contentClasses` from bundler hooks and call
 * `optimizeCssWithReport`. This function does the same job for any other
 * build tool, with the caller supplying the used components directly.
 */
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

export async function optimizeCarbonCss(
  css: string | Uint8Array,
  options: OptimizeCarbonCssOptions,
): Promise<OptimizedCssReport> {
  if (options.experimental?.liveIndex) {
    setComponents(await ensureLiveComponentIndex());
  }

  const ids = [...options.components];
  if (ids.length === 0) {
    return { css: toCssString(css), removed: 0 };
  }

  const contentClasses = new Set(
    scanContentClasses(options.content, options.cwd),
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
