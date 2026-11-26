import type { Summary } from "svelte-prune/internal";
import { logSummary } from "./print-diff";

/**
 * Where `optimizeCss` takes the build's rewrite count, for its
 * summary's header.
 */
export type RewriteHeader = { readonly silent: boolean; rewritten: number };

// Keyed by plugin object, so `rewriteReporter` can find each `optimizeCss`
// and `OptimizeCssPlugin` among a build's plugins.
const headers = new WeakMap<object, RewriteHeader>();

// `plugin` is an `optimizeCss`, so its summary's header reports the
// rewrites of its builds.
export function rewriteHeader(plugin: object, silent: boolean): RewriteHeader {
  const header = { silent, rewritten: 0 };
  headers.set(plugin, header);
  return header;
}

// For `optimizeComponents`: each build's rewrite count goes to the
// `optimizeCss` among the build's plugins, which prints it in its
// summary's header, or is printed here when there's none (or it's
// silent), instead of svelte-prune's sentence.
export function rewriteReporter(silent: boolean) {
  let header: RewriteHeader | undefined;
  let log: ((message: string) => void) | undefined;
  return {
    /** Before svelte-prune prepares the build: the plugins it's built with. */
    start(plugins: Iterable<unknown> | undefined, logger?: typeof log) {
      log = logger ?? log;
      header = undefined;
      for (const plugin of plugins ?? []) {
        const found =
          typeof plugin === "object" && plugin !== null
            ? headers.get(plugin)
            : undefined;
        if (found && !found.silent) header = found;
      }
      if (header) header.rewritten = 0;
    },
    onSummary(summary: Summary) {
      // Carbon has no `styles` for svelte-prune to prune: `optimizeCss` does.
      if (summary.kind !== "rewrite") return;
      if (header) header.rewritten = summary.components;
      else if (!silent) {
        logSummary({ assets: [], rewritten: summary.components, log });
      }
    },
  };
}
