import MagicString from "magic-string";
import type { SveltePreprocessor } from "svelte/types/compiler/preprocess";
import { getComponents, setComponents } from "../component-index-registry";
import { CarbonSvelte } from "../constants";
import { ensureLiveComponentIndex } from "../indexer/live-index";

const NODE_MODULES_REGEX = /node_modules/;
const COMPONENT_NAME_REGEX = /^[A-Z]/;

type ImportSpecifier = {
  imported: { name: string };
  local: { name: string };
  importKind?: "type" | "value";
};

type ImportStatement = {
  start: number;
  end: number;
  importKind?: "type" | "value";
  source: { value: string };
  specifiers: ImportSpecifier[];
};

// Import specifiers can't contain a semicolon, so bounding the clause with
// `[^;]` keeps the lazy match from ever crossing into a later statement,
// without needing a stateful parser to find each declaration's extent.
const IMPORT_DECLARATION_REGEX =
  /^([ \t]*)import\s+(type\s+)?(?:([^;]*?)\s+from\s+)?["']([^"']+)["']\s*;?/gm;
const NAMED_SPECIFIERS_REGEX = /\{([^}]*)\}/;
const TYPE_SPECIFIER_PREFIX_REGEX = /^type\s+/;
const AS_ALIAS_REGEX = /\s+as\s+/;

function parseSpecifiers(clause: string | undefined): ImportSpecifier[] {
  const namedClause = clause && NAMED_SPECIFIERS_REGEX.exec(clause)?.[1];
  if (!namedClause?.trim()) return [];

  return namedClause
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const isType = TYPE_SPECIFIER_PREFIX_REGEX.test(entry);
      const [imported, local] = entry
        .replace(TYPE_SPECIFIER_PREFIX_REGEX, "")
        .split(AS_ALIAS_REGEX);
      return {
        imported: { name: imported.trim() },
        local: { name: (local ?? imported).trim() },
        importKind: isType ? "type" : "value",
      } satisfies ImportSpecifier;
    });
}

/**
 * `optimizeImports` only ever rewrites named specifiers from three known
 * barrel sources (see the `switch` in `transformScript`), so this only needs
 * to recover exactly what `rewriteImport` reads: each statement's source,
 * span, and named specifiers. Default/namespace specifiers are never
 * rewritten, so they're intentionally left out of the parsed shape.
 */
function parseImportDeclarations(code: string): ImportStatement[] {
  const statements: ImportStatement[] = [];

  for (const match of code.matchAll(IMPORT_DECLARATION_REGEX)) {
    const [full, leadingWhitespace, typeKeyword, clause, source] = match;
    const start = match.index + leadingWhitespace.length;
    statements.push({
      start,
      end: match.index + full.length,
      importKind: typeKeyword ? "type" : "value",
      source: { value: source },
      specifiers: parseSpecifiers(clause),
    });
  }

  return statements;
}

function rewriteImport(
  s: MagicString,
  node: ImportStatement,
  map: (specifier: ImportSpecifier) => string,
) {
  // Type-only statements (`import type { ... }`) never reference a real
  // `.svelte` file, so leave them entirely untouched.
  if (node.importKind === "type") return;

  const rewritten: string[] = [];
  const preserved: ImportSpecifier[] = [];

  for (const specifier of node.specifiers) {
    // Per-specifier type imports (`import { type X, Y }`) stay on the barrel.
    const fragment = specifier.importKind === "type" ? "" : map(specifier);
    if (fragment) {
      rewritten.push(fragment.trimEnd());
    } else {
      // Falsy return: keep specifier for barrel re-import below.
      preserved.push(specifier);
    }
  }

  if (rewritten.length === 0) return;

  // Mixed imports: put preserved names back on the barrel next to rewritten paths.
  if (preserved.length > 0) {
    const names = preserved.map((specifier) => {
      const prefix = specifier.importKind === "type" ? "type " : "";
      return specifier.imported.name === specifier.local.name
        ? `${prefix}${specifier.local.name}`
        : `${prefix}${specifier.imported.name} as ${specifier.local.name}`;
    });
    rewritten.push(
      `import { ${names.join(", ")} } from "${node.source.value}";`,
    );
  }

  s.update(node.start, node.end, rewritten.join("\n"));
}

/**
 * Svelte preprocessor that transforms barrel imports from Carbon libraries
 * into direct path imports for better tree-shaking and faster builds.
 *
 * Skips loading the full component index, which speeds up HMR and builds.
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
 * Names missing from the component index: PascalCase gets an optimistic
 * `src/Name/Name.svelte` path; camelCase stays on the barrel so utilities
 * don't point at a `.svelte` file that isn't there.
 */
export type OptimizeImportsOptions = {
  experimental?: {
    /**
     * Build the component index from *this project's* installed
     * `carbon-components-svelte` instead of using the version bundled with
     * `carbon-preprocess-svelte`. Resolved once per build (cached on disk,
     * keyed by the installed Carbon version) and falls back to the bundled
     * index if anything about the live build fails.
     * @default false
     */
    liveIndex?: boolean;
  };
};

function transformScript(raw: string, filename: string) {
  const components = getComponents();
  const s = new MagicString(raw);

  for (const node of parseImportDeclarations(raw)) {
    const import_name = node.source.value;

    switch (import_name) {
      case CarbonSvelte.Components:
        rewriteImport(s, node, ({ imported, local }) => {
          // Prefer indexed path (handles .js and other special cases).
          const import_path = components[imported.name]?.path;
          if (import_path) {
            return `import ${local.name} from "${import_path}";`;
          }

          // Not in index: PascalCase gets an optimistic component path;
          // camelCase stays on the barrel (utility, not a .svelte file).
          const looks_like_component = COMPONENT_NAME_REGEX.test(imported.name);
          if (looks_like_component) {
            return `import ${local.name} from "${import_name}/src/${imported.name}/${imported.name}.svelte";`;
          }

          return "";
        });
        break;

      case CarbonSvelte.Icons:
      case CarbonSvelte.Pictograms:
        rewriteImport(s, node, ({ imported, local }) => {
          return `import ${local.name} from "${import_name}/lib/${imported.name}.svelte";`;
        });
        break;
    }
  }

  return {
    code: s.toString(),
    // Edits are whole-statement replacements, so boundary-level mapping
    // (one segment per edit) is as accurate as char-level and much cheaper.
    map: s.generateMap({ source: filename, hires: "boundary" }),
  };
}

export const optimizeImports: SveltePreprocessor<"script"> = (
  options?: OptimizeImportsOptions,
) => {
  let liveIndexReady: Promise<void> | undefined;

  return {
    name: "carbon:optimize-imports",
    // Not declared `async`: without `experimental.liveIndex`, this returns
    // the transformed result synchronously (existing callers rely on that).
    // Svelte's own preprocess pipeline accepts either a plain result or a
    // Promise, so the `liveIndex` branch returning a Promise below is
    // equally valid.
    script({ filename, content: raw }) {
      // Skip files in node_modules to minimize unnecessary preprocessing
      if (!filename) return;
      if (NODE_MODULES_REGEX.test(filename)) return;

      // Fast path: the only rewritable import sources contain "carbon-".
      // Skip MagicString + import scanning for the common no-Carbon file.
      if (!raw.includes("carbon-")) return;

      if (options?.experimental?.liveIndex) {
        liveIndexReady ??= ensureLiveComponentIndex().then(setComponents);
        return liveIndexReady.then(() => transformScript(raw, filename));
      }

      return transformScript(raw, filename);
    },
  };
};
