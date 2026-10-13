import { optimizerRegistry } from "./registry";

type LoaderContext = {
  resourcePath: string;
  resourceQuery: string;
  getOptions(): { id: string };
  addDependency(file: string): void;
  callback(error: null, code: string, map?: unknown): void;
};

/**
 * The webpack/Rspack loader the specializer's webpack plugin runs before
 * Svelte's on `.svelte` files: it serves the ones it rewrote for the app.
 */
export default function specializerLoader(
  this: LoaderContext,
  source: string,
  map?: unknown,
): void {
  const optimizer = optimizerRegistry().get(this.getOptions().id);
  // Rewritten for what `content` held: rebuild when any of it changes.
  if (optimizer?.rewritable(this.resourcePath)) {
    for (const file of optimizer.analyzed) this.addDependency(file);
  }
  const rewritten = optimizer?.load(this.resourcePath + this.resourceQuery);
  if (rewritten) this.callback(null, rewritten.code, rewritten.map);
  else this.callback(null, source, map);
}
