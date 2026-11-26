import { collectLibraryImports } from "svelte-prune/internal";
import { CARBON } from "../carbon-library";

// Reads the barrel and the direct paths `optimizeImports` produces, since
// either can name a component, in a whole `.svelte` file too. Type-only
// imports are skipped.
//
// Returns `true` when it may use components it doesn't name: a namespace
// import, `export *`, or a dynamic import of the barrel or of a
// computed path.
export function collectCarbonImports(
  source: string,
  into: Set<string>,
): boolean {
  return collectLibraryImports(CARBON, source, into);
}
