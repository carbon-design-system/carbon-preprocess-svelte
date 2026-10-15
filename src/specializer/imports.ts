import { lexImportsExports } from "sveast/lexer";
import { type LibrarySpec, libraryPatterns } from "./library-paths";

/**
 * Adds the names of `spec`'s components `source` (a whole `.svelte` file
 * is fine) imports or re-exports to `into`, from the barrel or from direct
 * paths. Type-only imports are skipped.
 *
 * Returns `true` when it may use components it doesn't name: a namespace
 * import, `export *`, or a dynamic import of the barrel or of a computed
 * path.
 */
export function collectLibraryImports(
  spec: LibrarySpec,
  source: string,
  into: Set<string>,
): boolean {
  if (!source.includes(spec.name)) return false;
  const patterns = libraryPatterns(spec);

  let all = false;
  const add = (from: string, names: () => Iterable<string>) => {
    const direct = patterns.directComponentName.exec(from);
    if (direct) into.add(direct[1]);
    else if (from === spec.name) {
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
  for (const match of source.matchAll(patterns.dynamicImport)) {
    if (match[2].includes("${")) all = true;
    else add(match[2], () => ["*"]);
  }
  return all;
}
