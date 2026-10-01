import { lexImportsExports } from "sveast/lexer";
import { CarbonSvelte } from "../constants";

const DIRECT_COMPONENT_PATH =
  /^carbon-components-svelte\/src\/.+\/([A-Za-z0-9_]+)\.svelte$/;

/**
 * Add the Carbon component names imported by `source` to `into`. Handles
 * both the barrel form and the direct-path form `optimizeImports` produces.
 * Type-only imports are skipped. `source` may be a whole `.svelte` file:
 * the lexer finds the imports in its `<script>` without splitting it out.
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
