import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { CarbonSvelte } from "../constants";

/** Where a name exported by Carbon's barrel is defined. */
export type CarbonExport = {
  /** Direct import path, e.g. `carbon-components-svelte/src/Button/Button.svelte`. */
  path: string;
  /** Binding to import from `path`: `"default"`, or a named export. */
  name: string;
};

type Binding = { local: string; source: string };

type ModuleExports = {
  /** Exported name -> the imported binding it passes on. */
  forwarded: Map<string, Binding>;
  declared: Set<string>;
  /** `export * from` sources. */
  stars: string[];
};

// `[^}]` spans newlines, so multi-line specifier lists match too.
const RE_EXPORT_REGEX = /export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
const EXPORT_LIST_REGEX = /export\s*\{([^}]*)\}(?!\s*from\b)/g;
const EXPORT_STAR_REGEX = /export\s*\*\s*from\s*["']([^"']+)["']/g;
const EXPORT_DECLARATION_REGEX =
  /export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([\w$]+)/g;
const IMPORT_REGEX =
  /import\s+([\w$]+)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g;
const COMMENT_REGEX = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const AS_REGEX = /\s+as\s+/;

/** Hops from the barrel to a definition; Carbon needs at most three. */
const MAX_HOPS = 8;

/** `a, b as c` -> `[["a", "a"], ["b", "c"]]` (original name, then alias). */
function parseSpecifiers(list: string): Array<[string, string]> {
  const specifiers: Array<[string, string]> = [];
  for (const specifier of list.split(",")) {
    const [name, alias = name] = specifier.trim().split(AS_REGEX);
    if (name) specifiers.push([name, alias]);
  }
  return specifiers;
}

function readModuleExports(file: string): ModuleExports {
  const code = readFileSync(file, "utf8").replace(COMMENT_REGEX, "");

  const imports = new Map<string, Binding>();
  for (const [, defaultName, named, source] of code.matchAll(IMPORT_REGEX)) {
    if (defaultName) imports.set(defaultName, { local: "default", source });
    for (const [imported, local] of parseSpecifiers(named ?? "")) {
      imports.set(local, { local: imported, source });
    }
  }

  const forwarded = new Map<string, Binding>();
  for (const [, list, source] of code.matchAll(RE_EXPORT_REGEX)) {
    for (const [local, exported] of parseSpecifiers(list)) {
      forwarded.set(exported, { local, source });
    }
  }

  const declared = new Set<string>();
  for (const [, name] of code.matchAll(EXPORT_DECLARATION_REGEX)) {
    declared.add(name);
  }
  // `import Button from "./Button.svelte"; export { Button };`
  for (const [, list] of code.matchAll(EXPORT_LIST_REGEX)) {
    for (const [local, exported] of parseSpecifiers(list)) {
      const imported = imports.get(local);
      if (imported) forwarded.set(exported, imported);
      else declared.add(exported);
    }
  }

  const stars = [...code.matchAll(EXPORT_STAR_REGEX)].map(
    ([, source]) => source,
  );

  return { forwarded, declared, stars };
}

function isFile(file: string): boolean {
  return statSync(file, { throwIfNoEntry: false })?.isFile() === true;
}

/** Node-style resolution of a relative specifier, as Carbon's barrels write them. */
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
 * Maps every name `carbon-components-svelte`'s `src/index.js` exports to the
 * module that defines it, following re-export chains: older releases
 * re-export each component through its folder's `index.js`
 * (`export { Button } from "./Button"`), newer ones point straight at the
 * `.svelte` file. `export *` and imported-then-exported names are followed
 * too. Reads only the barrel and the modules it re-exports from,
 * synchronously, with no Svelte compiler involved.
 */
export function readCarbonExports(
  carbonRoot: string,
): Map<string, CarbonExport> {
  const src = path.join(carbonRoot, "src");
  const barrel = path.join(src, "index.js");
  const modules = new Map<string, ModuleExports>();
  const namesByFile = new Map<string, Set<string>>();

  function exportsOf(file: string): ModuleExports {
    let exports = modules.get(file);
    if (!exports) {
      exports = readModuleExports(file);
      modules.set(file, exports);
    }
    return exports;
  }

  /** Every name `file` exports, including through `export *`. */
  function exportedNames(file: string): Set<string> {
    let names = namesByFile.get(file);
    if (names) return names;

    names = new Set<string>();
    // Set before recursing so an `export *` cycle ends here.
    namesByFile.set(file, names);
    const { forwarded, declared, stars } = exportsOf(file);
    for (const name of forwarded.keys()) names.add(name);
    for (const name of declared) names.add(name);
    for (const source of stars) {
      const target = resolveModule(file, source);
      if (!target?.endsWith(".js")) continue;
      for (const name of exportedNames(target)) {
        if (name !== "default") names.add(name);
      }
    }
    return names;
  }

  function definitionOf(
    file: string,
    name: string,
  ): { file: string; name: string } {
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      // `.svelte` modules only have a default export, and a default export
      // is where the chain ends: it is the definition.
      if (name === "default" || !file.endsWith(".js")) break;

      const { forwarded, declared, stars } = exportsOf(file);
      let next = forwarded.get(name);
      if (!next && !declared.has(name)) {
        const source = stars.find((star) => {
          const target = resolveModule(file, star);
          return target?.endsWith(".js") && exportedNames(target).has(name);
        });
        if (source) next = { local: name, source };
      }
      if (!next) break;

      const target = resolveModule(file, next.source);
      if (!target) break;
      file = target;
      name = next.local;
    }
    return { file, name };
  }

  const exports = new Map<string, CarbonExport>();

  for (const exported of exportedNames(barrel)) {
    const definition = definitionOf(barrel, exported);
    // Defined in the barrel itself, or unresolvable: stays on the barrel.
    if (definition.file === barrel) continue;

    exports.set(exported, {
      path: `${CarbonSvelte.Components}/src/${path.relative(src, definition.file).split(path.sep).join("/")}`,
      name: definition.name,
    });
  }

  return exports;
}
