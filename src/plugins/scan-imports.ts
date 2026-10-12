import { lexImportsExports } from "sveast/lexer";
import { CarbonSvelte } from "../constants";

const DIRECT_COMPONENT_PATH =
  /^carbon-components-svelte\/src\/.+\/([A-Za-z0-9_]+)\.svelte$/;

/**
 * `import()` or `require()` of the barrel, a component's path, or a path
 * computed from Carbon's name (`` `carbon-components-svelte/src/${name}…` ``).
 */
const CARBON_DYNAMIC_IMPORT =
  /\b(?:import|require)\s*\(\s*(["'`])(carbon-components-svelte(?:\/[^"'`]*)?)\1/g;

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
  if (!source.includes(CarbonSvelte.Components)) return false;

  let all = false;
  const add = (from: string, names: () => Iterable<string>) => {
    const direct = DIRECT_COMPONENT_PATH.exec(from);
    if (direct) into.add(direct[1]);
    else if (from === CarbonSvelte.Components) {
      for (const name of names()) {
        if (name === "*") all = true;
        else into.add(name);
      }
    }
  };

  for (const statement of lexImportsExports(source)) {
    const from = statement.source?.value;
    if (!from || statement.typeOnly) continue;
    add(from, () =>
      statement.kind === "export"
        ? statement.specifiers.flatMap((specifier) =>
            specifier.typeOnly ? [] : [specifier.local],
          )
        : statement.specifiers.flatMap((specifier) =>
            specifier.typeOnly || specifier.kind === "default"
              ? []
              : [specifier.imported],
          ),
    );
  }
  for (const match of source.matchAll(CARBON_DYNAMIC_IMPORT)) {
    if (match[2].includes("${")) all = true;
    else add(match[2], () => ["*"]);
  }
  return all;
}
