import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { lexImportsExports } from "sveast/lexer";
import { CarbonSvelte } from "../constants";

/** Where a name exported by Carbon's barrel is defined. */
export type CarbonExport = {
  /** Direct import path, e.g. `carbon-components-svelte/src/Button/Button.svelte`. */
  path: string;
  /** Binding to import from `path`: `"default"` or a named export. */
  name: string;
};

type ReExport = { local: string; source: string };

const IDENTIFIER_NAME = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*$/u;

/** Whether `name` can be written unquoted in an import or export specifier. */
export function isIdentifierName(name: string): boolean {
  return IDENTIFIER_NAME.test(name);
}

/** Carbon needs at most two hops from the barrel to a definition. */
const MAX_HOPS = 8;

/** `export { a, b as c } from "./x"` statements in `file`, by exported name. */
function readReExports(file: string): Map<string, ReExport> {
  const reExports = new Map<string, ReExport>();

  for (const statement of lexImportsExports(readFileSync(file, "utf8"))) {
    if (statement.kind !== "export" || !statement.source) continue;
    for (const { kind, local, exported } of statement.specifiers) {
      if (
        kind === "named" &&
        exported !== null &&
        isIdentifierName(local) &&
        isIdentifierName(exported)
      ) {
        reExports.set(exported, {
          local,
          source: statement.source.value,
        });
      }
    }
  }

  return reExports;
}

function isFile(file: string): boolean {
  return statSync(file, { throwIfNoEntry: false })?.isFile() === true;
}

/** Node-style resolution of a relative specifier. */
function resolveModule(from: string, source: string): string | undefined {
  const base = path.resolve(path.dirname(from), source);
  return [
    base,
    `${base}.js`,
    `${base}.svelte`,
    path.join(base, "index.js"),
  ].find(isFile);
}

/**
 * Maps every name exported by `carbon-components-svelte`'s `src/index.js` to
 * the module that defines it, following re-export chains: older releases go
 * through each folder's `index.js` (`export { Button } from "./Button"`),
 * newer ones point straight at the `.svelte` file.
 */
export function readCarbonExports(
  carbonRoot: string,
): Map<string, CarbonExport> {
  const src = path.join(carbonRoot, "src");
  const barrel = path.join(src, "index.js");
  const reExportsByFile = new Map<string, Map<string, ReExport>>();

  function reExportsOf(file: string): Map<string, ReExport> {
    let reExports = reExportsByFile.get(file);
    if (!reExports) {
      reExports = readReExports(file);
      reExportsByFile.set(file, reExports);
    }
    return reExports;
  }

  const exports = new Map<string, CarbonExport>();

  for (const [exported, reExport] of reExportsOf(barrel)) {
    let file = resolveModule(barrel, reExport.source);
    let name = reExport.local;

    for (let hop = 0; file && hop < MAX_HOPS; hop++) {
      // A default export, or any `.svelte` module, is the definition.
      if (name === "default" || !file.endsWith(".js")) break;
      const next = reExportsOf(file).get(name);
      if (!next) break;
      const target = resolveModule(file, next.source);
      if (!target) break;
      file = target;
      name = next.local;
    }

    if (!file) continue;

    exports.set(exported, {
      path: `${CarbonSvelte.Components}/src/${path.relative(src, file).split(path.sep).join("/")}`,
      name,
    });
  }

  return exports;
}
