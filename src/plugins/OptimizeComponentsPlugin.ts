import { existsSync } from "node:fs";
import type { Summary } from "svelte-prune/internal";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WebpackCompiler } from "svelte-prune/internal";
import { SveltePrunePlugin } from "svelte-prune/webpack";
import { CARBON, SPECIALIZE_FAILURE } from "../carbon-library";
import type { OptimizeComponentsOptions } from "./optimize-components";
import { rewriteReporter } from "./rewrite-header";

/** The loader's built file next to the bundle, or its source in a checkout. */
const LOADER = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "optimize-components-loader.js"),
    path.join(here, "..", "optimize-components-loader.ts"),
  ];
  return candidates.find((file) => existsSync(file)) ?? candidates[0];
})();

/**
 * `optimizeComponents` for webpack and Rspack: rewrites
 * each Carbon component the app renders for the props it passes. Pair it
 * with `new OptimizeCssPlugin()`.
 *
 * Runs on production builds only. It adds a loader that runs before
 * `svelte-loader` on `.svelte` files, and fails the build if a
 * module outside `content` imports a Carbon component.
 */
export class OptimizeComponentsPlugin {
  private plugin: SveltePrunePlugin;
  private reporter: ReturnType<typeof rewriteReporter>;

  public constructor(options?: OptimizeComponentsOptions) {
    this.reporter = rewriteReporter(options?.silent === true);
    this.plugin = new SveltePrunePlugin(CARBON, options, {
      plugin: "OptimizeComponentsPlugin",
      failure: SPECIALIZE_FAILURE,
      loader: LOADER,
      onSummary: (summary: Summary) => this.reporter.onSummary(summary),
    });
  }

  public apply(compiler: WebpackCompiler) {
    // Typed without `plugins`, which webpack and Rspack both set.
    const { options } = compiler;
    const plugins: unknown = "plugins" in options ? options.plugins : undefined;
    this.reporter.start(Array.isArray(plugins) ? plugins : undefined);
    this.plugin.apply(compiler);
  }
}
