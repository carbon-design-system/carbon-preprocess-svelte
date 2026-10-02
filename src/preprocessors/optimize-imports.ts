import path from "node:path";
import { type LexedImport, lexImportsExports } from "sveast/lexer";
import type { SveltePreprocessor } from "svelte/types/compiler/preprocess";
import { CarbonSvelte, LOG_PREFIX } from "../constants";
import {
  type CarbonExport,
  isIdentifierName,
  readCarbonExports,
} from "../indexer/carbon-exports";
import { resolveCarbonRoot } from "../indexer/resolve-carbon-root";
import { MappingsBuilder } from "./mappings-builder";

const NODE_MODULES_REGEX = /[\\/]node_modules[\\/]/;

const BARRELS = new Set<string>([
  CarbonSvelte.Components,
  CarbonSvelte.Icons,
  CarbonSvelte.Pictograms,
]);

/** Carbon's barrel exports, read on first use so icon-only files don't need it installed. */
export type CarbonExportsLoader = () => ReadonlyMap<string, CarbonExport>;

/** `import local from "path"` or `import { name as local } from "path"`. */
function directImport(local: string, path: string, name: string): string {
  if (name === "default") return `import ${local} from "${path}";`;
  const binding = name === local ? name : `${name} as ${local}`;
  return `import { ${binding} } from "${path}";`;
}

/** The direct-path import for `imported`, or `undefined` to keep it on the barrel. */
function directReplacement(
  source: string,
  imported: string,
  local: string,
  loadExports: CarbonExportsLoader,
): string | undefined {
  if (!isIdentifierName(imported)) return undefined;
  if (source !== CarbonSvelte.Components) {
    return `import ${local} from "${source}/lib/${imported}.svelte";`;
  }
  const target = loadExports().get(imported);
  return target && directImport(local, target.path, target.name);
}

/**
 * The direct-path replacement for one barrel import statement, or `null` when
 * nothing changes. Type-only specifiers, default and namespace imports, and
 * names the installed Carbon's barrel doesn't export stay on the barrel.
 */
function rewriteImport(
  statement: LexedImport,
  loadExports: CarbonExportsLoader,
): string | null {
  const source = statement.source?.value;
  if (source === undefined || statement.typeOnly || !BARRELS.has(source)) {
    return null;
  }

  const lines: string[] = [];
  const kept: string[] = [];
  const keptNamed: string[] = [];

  for (const specifier of statement.specifiers) {
    const { local } = specifier;

    if (specifier.kind !== "named") {
      kept.push(specifier.kind === "default" ? local : `* as ${local}`);
      continue;
    }

    const { imported, typeOnly } = specifier;
    const replacement = typeOnly
      ? undefined
      : directReplacement(source, imported, local, loadExports);

    if (replacement !== undefined) {
      lines.push(replacement);
      continue;
    }

    const name = isIdentifierName(imported)
      ? imported
      : JSON.stringify(imported);
    const binding = name === local ? local : `${name} as ${local}`;
    keptNamed.push(typeOnly ? `type ${binding}` : binding);
  }

  if (lines.length === 0) return null;

  // Mixed import: keep the preserved names on the barrel.
  if (keptNamed.length > 0) kept.push(`{ ${keptNamed.join(", ")} }`);
  if (kept.length > 0)
    lines.push(`import ${kept.join(", ")} from "${source}";`);

  return lines.join("\n");
}

export function transformScript(
  raw: string,
  filename: string,
  loadExports: CarbonExportsLoader,
) {
  let code = "";
  let mappings: MappingsBuilder | undefined;
  let lastIndex = 0;

  for (const node of lexImportsExports(raw)) {
    if (node.kind !== "import") continue;
    const replacement = rewriteImport(node, loadExports);
    if (replacement === null) continue;

    const unchanged = raw.slice(lastIndex, node.start);
    mappings ??= new MappingsBuilder();
    mappings.copy(unchanged);
    mappings.replace(replacement, raw, node.start, node.end);

    code += unchanged + replacement;
    lastIndex = node.end;
  }

  // Nothing rewritten: Svelte treats a missing map as an identity map.
  if (mappings === undefined) return { code: raw };

  const tail = raw.slice(lastIndex);
  mappings.copy(tail);
  code += tail;

  // Svelte only offsets the map to the `<script>` position when `sources`
  // is the file's basename.
  const basename = filename.slice(
    Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\")) + 1,
  );

  return {
    code,
    map: {
      version: 3,
      sources: [basename],
      names: [],
      mappings: mappings.toString(),
    },
  };
}

/** Barrel exports of the Carbon a directory resolves; cached per directory and install, warns once. */
function createCarbonExportsResolver(): (
  dir: string,
) => ReadonlyMap<string, CarbonExport> {
  const byDir = new Map<string, ReadonlyMap<string, CarbonExport>>();
  const byCarbonRoot = new Map<string, ReadonlyMap<string, CarbonExport>>();
  let warned = false;

  return (dir) => {
    let exports = byDir.get(dir);
    if (exports) return exports;

    try {
      const carbonRoot = resolveCarbonRoot(dir);
      exports = byCarbonRoot.get(carbonRoot);
      if (!exports) {
        exports = readCarbonExports(carbonRoot);
        byCarbonRoot.set(carbonRoot, exports);
      }
    } catch (error) {
      if (!warned) {
        warned = true;
        console.warn(
          `${LOG_PREFIX} optimizeImports could not read the exports of the installed ${CarbonSvelte.Components} (${error instanceof Error ? error.message : error}); leaving its imports on the barrel.`,
        );
      }
      exports = new Map();
    }

    byDir.set(dir, exports);
    return exports;
  };
}

/**
 * Svelte preprocessor that transforms barrel imports from Carbon libraries
 * into direct path imports for better tree-shaking and faster builds.
 *
 * @example
 * ```ts
 *   import { Button, Modal } from "carbon-components-svelte";
 *   import { Add } from "carbon-icons-svelte";
 *   import { Airplane } from "carbon-pictograms-svelte";
 * ```
 * becomes:
 * ```ts
 *   import Button from "carbon-components-svelte/src/Button/Button.svelte";
 *   import Modal from "carbon-components-svelte/src/Modal/Modal.svelte";
 *   import Add from "carbon-icons-svelte/lib/Add.svelte";
 *   import Airplane from "carbon-pictograms-svelte/lib/Airplane.svelte";
 * ```
 *
 * Component paths come from the `src/index.js` of the
 * `carbon-components-svelte` each file resolves, so they match the installed
 * version. Names that barrel doesn't export stay on the barrel.
 */
export const optimizeImports: SveltePreprocessor<"script"> = () => {
  const carbonExportsFor = createCarbonExportsResolver();

  return {
    name: "carbon:optimize-imports",
    script({ filename, content: raw }) {
      if (!filename || NODE_MODULES_REGEX.test(filename)) return;
      // Fast path: every rewritable import source contains "carbon-".
      if (!raw.includes("carbon-")) return;

      const dir = path.dirname(path.resolve(filename));
      return transformScript(raw, filename, () => carbonExportsFor(dir));
    },
  };
};
