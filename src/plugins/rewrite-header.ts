import type { Summary } from "svelte-prune/internal";
import { logSummary } from "./print-diff";

/** Where `optimizeCss` takes the build's rewrite count, for its summary's header. */
export type RewriteHeader = { readonly silent: boolean; rewritten: number };

/** Each `optimizeCss` and `OptimizeCssPlugin`, by its plugin object. */
const headers = new WeakMap<object, RewriteHeader>();

/** Registers `plugin`, an `optimizeCss`, to report the rewrites of its builds. */
export function rewriteHeader(plugin: object, silent: boolean): RewriteHeader {
  const header = { silent, rewritten: 0 };
  headers.set(plugin, header);
  return header;
}

/**
 * For `optimizeComponents`: hands each build's rewrite count to the
 * `optimizeCss` among the build's plugins, which prints it in its summary's
 * header, or prints it itself when there's none (or it's silent), in place
 * of svelte-prune's sentence.
 */
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
