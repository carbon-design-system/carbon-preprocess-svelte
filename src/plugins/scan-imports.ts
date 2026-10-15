import { collectLibraryImports } from "severan/internal";
import { CARBON } from "../carbon-library";

/**
 * Adds the Carbon component names `source` (a whole `.svelte` file is
 * fine) imports or re-exports to `into`, from the barrel or from the
 * direct paths `optimizeImports` produces. Type-only imports are skipped.
 *
 * Returns `true` when it may use components it doesn't name: a namespace
 * import, `export *`, or a dynamic import of the barrel or of a computed
 * path.
 */
export function collectCarbonImports(
  source: string,
  into: Set<string>,
): boolean {
  return collectLibraryImports(CARBON, source, into);
}
