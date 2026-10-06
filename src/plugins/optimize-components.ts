import type { Plugin } from "vite";
import {
  createComponentOptimizer,
  type OptimizeComponentsOptions,
} from "./component-optimizer";

export type { OptimizeComponentsOptions };

/**
 * **Experimental.** Vite, Rollup and Rolldown plugin that rewrites each Carbon component
 * the app renders for the props it passes: values that never change become
 * literals, and branches that can't run go, along with the components only
 * they render. Pair it with `optimizeCss({ experimental: { propAware: true } })`,
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
    apply: "build",
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
      const error = optimizer.error();
      if (error) this.error(error);
    },
  };
};
