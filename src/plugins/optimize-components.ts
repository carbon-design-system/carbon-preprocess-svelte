import type { Plugin } from "vite";
import {
  createComponentOptimizer,
  type OptimizeComponentsOptions,
} from "./component-optimizer";

export type { OptimizeComponentsOptions };

/**
 * Vite, Rollup and Rolldown plugin that rewrites each Carbon component
 * the app renders for the props it passes: values that never change become
 * literals, and branches that can't run go, along with the components only
 * they render. Pair it with `optimizeCss({ propAware: true })`,
 * which prunes the styles of the same branches.
 *
 * Runs on production builds only, before Svelte compiles. Rewritten
 * components come with source maps back to Carbon's source.
 */
export const optimizeComponents = (
  options?: OptimizeComponentsOptions,
): Plugin => {
  let root = process.cwd();
  const optimizer = createComponentOptimizer(options, "optimizeComponents");

  return {
    name: "vite:carbon:optimize-components",
    // Builds only (`vite build`, `--watch` included), never the dev server:
    // the analysis runs up front for the whole app, dev serving and HMR
    // would leave rewritten components stale when an app prop changes,
    // and the check in `buildEnd` needs the complete module graph. Rollup
    // and Rolldown ignore `apply`, so there it's up to the config.
    apply: "build",
    // Before the Svelte plugin: `load` hands Svelte the rewritten Carbon
    // source to compile (the first `load` that returns wins), and
    // `transform` reads app modules before a preprocessor changes them.
    // Neither Svelte plugin loads plain `.svelte` files today, so this is
    // a safeguard; Vite sorts `pre` plugins first, Rollup and Rolldown go
    // by array order.
    enforce: "pre",
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      const { warning, info, report } = await optimizer.prepare(root);
      if (warning) this.warn(warning);
      if (info) this.info?.(info);
      for (const line of report ?? []) console.log(line);
    },
    load(id) {
      return optimizer.load(id);
    },
    transform(code, id) {
      optimizer.check(id, code, root);
    },
    buildEnd() {
      // The app components whose props came from their call sites: check
      // nothing outside `content` imports them.
      for (const id of this.getModuleIds()) {
        if (!optimizer.isClosed(id)) continue;
        const info = this.getModuleInfo(id);
        if (!info) continue;
        // An entry is mounted by something outside the module graph.
        const importers: Array<string | undefined> = [...info.importers];
        if (info.isEntry) importers.push(undefined);
        optimizer.checkImporters(
          id,
          importers,
          info.dynamicImporters.length > 0,
          root,
        );
      }
      const error = optimizer.error();
      if (error) this.error(error);
    },
  };
};
