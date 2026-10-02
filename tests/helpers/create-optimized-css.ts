import {
  type CssOptimizerOptions,
  optimizeCssWithReport,
} from "carbon-preprocess-svelte/plugins/create-optimized-css";

/** The optimized CSS alone, without the `removed` count. */
export function createOptimizedCss(
  options: CssOptimizerOptions & { source: Uint8Array | string },
): string {
  return optimizeCssWithReport(options).css;
}
