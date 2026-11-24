import type { SveltePruneOptions } from "svelte-prune";
import { sveltePrune } from "svelte-prune/vite";
import { CARBON, SPECIALIZE_FAILURE } from "../carbon-library";
import type { BundlerPlugin } from "./bundler-plugin";
import { rewriteReporter } from "./rewrite-header";

export type OptimizeComponentsOptions = SveltePruneOptions;

/**
 * Vite, Rollup and Rolldown plugin that rewrites each Carbon component
 * the app renders for the props it passes: values that never change become
 * literals, and branches that can't run go, along with the components only
 * they render. The app's own wrapper components are rewritten too when
 * every call site is in `content`. Pair it with
 * `optimizeCss({ propAware: true })`, which prunes the styles of the
 * same branches.
 *
 * Runs on production builds only, before Svelte compiles. Rewritten
 * components come with source maps back to their original source. For an
 * app that only mounts, `hydration: false` also drops Svelte 5's hydration
 * code; the build fails if it can still hydrate (SvelteKit with SSR).
 */
export const optimizeComponents = (
  options?: OptimizeComponentsOptions,
): BundlerPlugin => {
  const reporter = rewriteReporter(options?.silent === true);
  const plugin = sveltePrune(CARBON, options, {
    id: "vite:carbon:optimize-components",
    plugin: "optimizeComponents",
    failure: SPECIALIZE_FAILURE,
    onSummary: reporter.onSummary,
  });
  let plugins: readonly unknown[] | undefined;
  let log: ((message: string) => void) | undefined;
  // In place: svelte-prune finds its analysis by this plugin object.
  const { configResolved, buildStart } = plugin;
  plugin.configResolved = function (config) {
    // Tests pass a bare config.
    const { logger } = config as Partial<typeof config>;
    plugins = config.plugins;
    log = logger && ((message) => logger.info(message));
    return call(configResolved, this, config);
  };
  // Rollup and Rolldown have no config: their plugins, then.
  plugin.buildStart = function (inputOptions) {
    reporter.start(
      plugins ??
        (inputOptions as Partial<typeof inputOptions> | undefined)?.plugins,
      log,
    );
    return call(buildStart, this, inputOptions);
  };
  return plugin;
};

/** Calls a Vite hook, given as a function or as `{ handler }`. */
function call<This, Args extends unknown[], Result>(
  hook:
    | ((this: This, ...args: Args) => Result)
    | { handler: (this: This, ...args: Args) => Result }
    | undefined,
  context: This,
  ...args: Args
): Result | undefined {
  if (!hook) return undefined;
  return (typeof hook === "function" ? hook : hook.handler).apply(
    context,
    args,
  );
}
