import type { ComponentOptimizer } from "./component-optimizer";

const KEY = Symbol.for("carbon-preprocess-svelte.optimizeComponents");

/**
 * Optimizers by id, for the loader `OptimizeComponentsPlugin` adds: loader
 * options must be plain data under Rspack, and the loader may load as its
 * own copy of this module, so the map lives on `globalThis`.
 */
export function optimizerRegistry(): Map<string, ComponentOptimizer> {
  const scope = globalThis as { [KEY]?: Map<string, ComponentOptimizer> };
  scope[KEY] ??= new Map();
  return scope[KEY];
}
