import { lexImportsExports } from "sveast/lexer";
import {
  type LibraryImport,
  type LibrarySpec,
  libraryPaths,
} from "./library-paths";
import { stripQuery } from "./util";

/** The parts of a Rollup/Vite plugin context the module graph is read with. */
export type ModuleGraph = {
  getModuleIds(): IterableIterator<string>;
  getModuleInfo(id: string): {
    code?: string | null;
    importers: readonly string[];
    dynamicImporters: readonly string[];
  } | null;
  resolve(
    source: string,
    importer: string,
  ): Promise<{ id: string } | null | undefined>;
};

/** A literal `import("…")`, which the lexer doesn't read. */
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(["'`])([^"'`$]+)\1\s*\)/g;
/** Specifiers that can't be an alias of the library, so aren't resolved again. */
const NOT_AN_ALIAS = /^(?:\.|\/|\0|svelte(?:\/|$))/;

/** Every specifier `code` imports, re-exports or loads with a literal `import()`. */
function specifiersOf(code: string): Set<string> {
  const specifiers = new Set<string>();
  for (const statement of lexImportsExports(code)) {
    if (statement.source) specifiers.add(statement.source.value);
  }
  for (const match of code.matchAll(DYNAMIC_IMPORT)) specifiers.add(match[2]);
  return specifiers;
}

/**
 * The module graph's edges into the library's components and barrel, from
 * outside it. The graph doesn't say which specifier made an edge, so each
 * importer's code is read for imports that resolve into the library under
 * another name (an alias): those edges come with their `specifier`.
 */
export async function libraryImports(
  spec: LibrarySpec,
  graph: ModuleGraph,
): Promise<LibraryImport[]> {
  const library = libraryPaths(spec);
  const edges: LibraryImport[] = [];
  const importers = new Set<string>();
  for (const id of graph.getModuleIds()) {
    if (!library.importKey(id)) continue;
    const info = graph.getModuleInfo(id);
    for (const importer of [
      ...(info?.importers ?? []),
      ...(info?.dynamicImporters ?? []),
    ]) {
      if (library.moduleKey(stripQuery(importer))) continue;
      edges.push({ id, importer });
      importers.add(importer);
    }
  }

  const resolving: Array<Promise<void>> = [];
  for (const importer of importers) {
    const code = graph.getModuleInfo(importer)?.code;
    if (!code) continue;
    for (const specifier of specifiersOf(code)) {
      if (library.isSpecifier(specifier) || NOT_AN_ALIAS.test(specifier)) {
        continue;
      }
      resolving.push(
        graph.resolve(specifier, importer).then(
          (resolved) => {
            if (resolved && library.importKey(resolved.id)) {
              edges.push({ id: resolved.id, importer, specifier });
            }
          },
          () => {},
        ),
      );
    }
  }
  await Promise.all(resolving);
  return edges;
}
