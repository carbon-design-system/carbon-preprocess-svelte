import { loadComponentIndex } from "../indexer/load-index";
import { toCssString } from "../utils";
import {
  type OptimizedCssReport,
  optimizeCssWithReport,
  type PruneOptions,
} from "./create-optimized-css";
import type { OptimizeCssOptions } from "./options";
import { collectCarbonTokens, scanContent } from "./scan-content";

type OptimizeCarbonCssOptions = PruneOptions &
  Pick<OptimizeCssOptions, "content"> & {
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
  });
}
