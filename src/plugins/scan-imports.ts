import { lexImportsExports } from "sveast/lexer";
import { CarbonSvelte } from "../constants";

const DIRECT_COMPONENT_PATH =
  /^carbon-components-svelte\/src\/.+\/([A-Za-z0-9_]+)\.svelte$/;

/**
 * Adds the Carbon component names imported by `source` (a whole `.svelte`
 * file is fine) to `into`, from the barrel or from the direct paths
 * `optimizeImports` produces. Type-only imports are skipped.
 */
export function collectCarbonImports(source: string, into: Set<string>): void {
  if (!source.includes(CarbonSvelte.Components)) return;

  for (const statement of lexImportsExports(source)) {
    const from = statement.source?.value;
    if (statement.kind !== "import" || !from || statement.typeOnly) continue;

    if (from === CarbonSvelte.Components) {
      for (const specifier of statement.specifiers) {
        if (specifier.kind === "named" && !specifier.typeOnly) {
          into.add(specifier.imported);
        }
      }
    } else {
      const direct = DIRECT_COMPONENT_PATH.exec(from);
      if (direct) into.add(direct[1]);
    }
  }
}
