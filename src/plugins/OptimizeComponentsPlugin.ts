import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CARBON, SPECIALIZE_FAILURE } from "../carbon-library";
import {
  SpecializerWebpackPlugin,
  type WebpackCompiler,
} from "../specializer/webpack";
import type { OptimizeComponentsOptions } from "./optimize-components";

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
 * with `new OptimizeCssPlugin({ propAware: true })`.
 *
 * Runs on production builds only. It adds a loader that runs before
 * `svelte-loader` on `.svelte` files, and fails the build if a
 * module outside `content` imports a Carbon component.
 */
export class OptimizeComponentsPlugin {
  private plugin: SpecializerWebpackPlugin;

  public constructor(options?: OptimizeComponentsOptions) {
    this.plugin = new SpecializerWebpackPlugin(CARBON, options, {
      plugin: "OptimizeComponentsPlugin",
      failure: SPECIALIZE_FAILURE,
      loader: LOADER,
    });
  }

  public apply(compiler: WebpackCompiler) {
    this.plugin.apply(compiler);
  }
}
