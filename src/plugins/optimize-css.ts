import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import { conditions, internalUsages } from "../component-conditions";
import { isCarbonSvelteImport, isCssFile, isSvelteFile } from "../utils";
import type { Observed } from "./analyze-usage";
import { computePruneSet, extractUsages, mergeObserved } from "./analyze-usage";
import type { OptimizeCssOptions } from "./create-optimized-css";
import { createOptimizedCss, isSilent } from "./create-optimized-css";
import { printDiff } from "./print-diff";

/**
 * Builds the experimental prune-set: class selectors proven unreachable by
 * statically analyzing how Carbon components are used across the app.
 *
 * Returns `undefined` (falling back to conservative optimization) whenever the
 * analysis can't be trusted: an app source file is unreadable or unparseable,
 * or uses a dynamic `<svelte:component>` whose rendered component is unknown.
 */
async function buildPruneSet(
  ids: Iterable<string>,
  userModules: Iterable<string>,
  silent: boolean,
): Promise<Set<string> | undefined> {
  const files = [...userModules];

  const results = await Promise.all(
    files.map(async (file) => {
      try {
        const code = await readFile(file, "utf8");
        return extractUsages({ code, filename: file });
      } catch {
        return null;
      }
    }),
  );

  const observed: Observed = {};

  for (const result of results) {
    if (!result?.ok || result.dynamicComponent) {
      if (!silent) {
        console.log(
          "[carbon:optimize-css] experimental.prunePropClasses: skipped pruning (an app file could not be analyzed or uses a dynamic component).",
        );
      }
      return undefined;
    }
    mergeObserved(observed, result.observed);
  }

  // Fold in Carbon-internal composition (e.g. a notification rendering
  // <Button size="small">) so classes emitted via children are never pruned.
  for (const id of ids) {
    const usage = internalUsages[path.parse(id).name];
    if (usage) mergeObserved(observed, usage);
  }

  return computePruneSet(conditions, observed);
}

/**
 * Vite/Rollup plugin that removes unused Carbon CSS classes from production builds.
 *
 * Unlike the Webpack plugin which uses module dependency tracking, this plugin
 * collects component IDs during the `transform` hook as modules are processed.
 * The actual CSS optimization happens in `generateBundle` after all modules
 * have been transformed and the bundle structure is finalized.
 *
 * The plugin is configured with `apply: "build"` and `enforce: "post"` to ensure:
 * - It only runs during production builds (not dev server)
 * - It runs after other plugins have finished transforming modules
 */
export const optimizeCss = (options?: OptimizeCssOptions): Plugin => {
  const silent = isSilent(options);
  const prunePropClasses = options?.experimental?.prunePropClasses === true;
  /**
   * Set of absolute file paths to Carbon Svelte components used in the app.
   * Populated during the transform phase, consumed during generateBundle.
   */
  const ids = new Set<string>();
  /**
   * Set of app (non-`node_modules`) `.svelte` module paths. Used by the
   * experimental prop analysis to discover how Carbon components are used.
   */
  const userModules = new Set<string>();

  return {
    name: "vite:carbon:optimize-css",
    apply: "build",
    enforce: "post",
    /**
     * The transform hook is called for every module in the build graph.
     * We don't modify the code here—we just track which Carbon components
     * are imported so we know which CSS classes to preserve later.
     */
    transform(_, id) {
      if (isCarbonSvelteImport(id)) {
        ids.add(id);
        return;
      }

      if (prunePropClasses && !id.startsWith("\0")) {
        const file = id.split("?")[0];
        if (isSvelteFile(file) && !file.includes("node_modules")) {
          userModules.add(file);
        }
      }
    },
    /**
     * generateBundle runs after all chunks and assets have been created.
     * We iterate through CSS assets and run PostCSS to remove unused rules.
     * Mutating `file.source` directly updates the bundle output in-place.
     */
    async generateBundle(_, bundle) {
      // Skip processing if no Carbon Svelte imports are found.
      if (ids.size === 0) return;

      const pruneSet = prunePropClasses
        ? await buildPruneSet(ids, userModules, silent)
        : undefined;

      for (const id in bundle) {
        const file = bundle[id];

        if (file.type === "asset" && isCssFile(id)) {
          const original_css = file.source;
          const optimized_css = createOptimizedCss({
            ...options,
            source: original_css,
            ids,
            pruneSet,
            from: id,
          });

          file.source = optimized_css;

          if (!silent) {
            printDiff({ original_css, optimized_css, id });
          }
        }
      }
    },
  };
};
