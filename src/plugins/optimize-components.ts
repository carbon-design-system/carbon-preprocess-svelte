import type { SeveranOptions } from "severan";
import { severan } from "severan/vite";
import { CARBON, SPECIALIZE_FAILURE } from "../carbon-library";
import type { BundlerPlugin } from "./bundler-plugin";

export type OptimizeComponentsOptions = SeveranOptions;

/**
 * Vite, Rollup and Rolldown plugin that rewrites each Carbon component
 * the app renders for the props it passes: values that never change become
 * literals, and branches that can't run go, along with the components only
 * they render. The app's own wrapper components are rewritten too when
 * every call site is in `content`. Pair it with
 * `optimizeCss({ propAware: true })`, which prunes the styles of the same
 * branches.
 *
 * Runs on production builds only, before Svelte compiles. Rewritten
 * components come with source maps back to their original source.
 */
export const optimizeComponents = (
  options?: OptimizeComponentsOptions,
): BundlerPlugin =>
  severan(CARBON, options, {
    id: "vite:carbon:optimize-components",
    plugin: "optimizeComponents",
    failure: SPECIALIZE_FAILURE,
  });
