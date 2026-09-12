import type { parse } from "svelte/compiler";

export type SvelteParser = typeof parse;

/**
 * `svelte/compiler` is loaded on demand, never at module scope: it's only
 * needed by the live index, and this package declares no dependency on
 * `svelte` (bundling the compiler would defeat the point, and a peer
 * dependency would be paid by consumers who never opt in). The dynamic
 * import stays dynamic in `dist/index.js`, so a default build never touches
 * the compiler and a missing/incompatible `svelte` only surfaces inside the
 * live-index path, where it's caught and falls back to the frozen index.
 */
export async function loadSvelteParser(): Promise<SvelteParser> {
  const compiler = await import("svelte/compiler");
  return compiler.parse;
}
