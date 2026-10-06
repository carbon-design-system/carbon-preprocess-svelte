import { optimizerRegistry } from "./plugins/optimizer-registry";

type LoaderContext = {
  resourcePath: string;
  resourceQuery: string;
  getOptions(): { id: string };
  addDependency(file: string): void;
  callback(error: null, code: string, map?: unknown): void;
};

/**
 * The webpack/Rspack loader `OptimizeComponentsPlugin` runs before Svelte's
 * on Carbon's `.svelte` files: it serves each one rewritten for the app.
 */
export default function optimizeComponentsLoader(
  this: LoaderContext,
  source: string,
  map?: unknown,
): void {
  const optimizer = optimizerRegistry().get(this.getOptions().id);
  // Rewritten for what `content` held: rebuild when any of it changes.
  for (const file of optimizer?.analyzed ?? []) this.addDependency(file);
  const rewritten = optimizer?.load(this.resourcePath + this.resourceQuery);
  if (rewritten) this.callback(null, rewritten.code, rewritten.map);
  else this.callback(null, source, map);
}
