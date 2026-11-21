import type { SveltePruneOptions } from "svelte-prune";
import { sveltePrune } from "svelte-prune/vite";
import { CARBON, SPECIALIZE_FAILURE } from "../carbon-library";
import type { BundlerPlugin } from "./bundler-plugin";

export type OptimizeComponentsOptions = SveltePruneOptions;

/**
 * Vite, Rollup and Rolldown plugin that rewrites each Carbon component
 * the app renders for the props it passes: values that never change become
 * literals, and branches that can't run go, along with the components only
 * they render. The app's own wrapper components are rewritten too when
 * every call site is in `content`. With `optimizeCss` in the same build,
 * CSS is pruned from this analysis, so styles go with the same branches.
 *
 * Runs on production builds only, before Svelte compiles. Rewritten
 * components come with source maps back to their original source. For an
 * app that only mounts, `hydration: false` also drops Svelte 5's hydration
 * code; the build fails if it can still hydrate (SvelteKit with SSR).
 */
export const optimizeComponents = (
  options?: OptimizeComponentsOptions,
): BundlerPlugin =>
  sveltePrune(CARBON, options, {
    id: "vite:carbon:optimize-components",
    plugin: "optimizeComponents",
    failure: SPECIALIZE_FAILURE,
  });
