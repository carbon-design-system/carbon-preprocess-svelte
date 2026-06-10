import type { ImportDeclaration } from "estree-walker";
import { walk } from "estree-walker";
import MagicString from "magic-string";
import { parse } from "svelte/compiler";
import type { SveltePreprocessor } from "svelte/types/compiler/preprocess";
import { components } from "../component-index";
import { CarbonSvelte } from "../constants";

const NODE_MODULES_REGEX = /node_modules/;
const COMPONENT_NAME_REGEX = /^[A-Z]/;
const SCRIPT_OPEN_TAG_REGEX = /^<script lang="ts">/;
const SCRIPT_CLOSE_TAG_REGEX = /<\/script>$/;

export type OptimizeImportsOptions = {
  /**
   * If a PascalCase import isn't in the bundled index, guess
   * `carbon-components-svelte/src/Name/Name.svelte`. Works for components added
   * after the index was built. Breaks the build if the name isn't real.
   *
   * `false` leaves un-indexed names on the barrel import. camelCase utilities
   * always stay on the barrel either way.
   * @default true
   */
  optimistic?: boolean;
};

function rewriteImport(
  s: MagicString,
  node: ImportDeclaration,
  map: (specifier: ImportDeclaration["specifiers"][0]) => string,
) {
  const rewritten: string[] = [];
  const preserved: ImportDeclaration["specifiers"] = [];

  for (const specifier of node.specifiers) {
    const fragment = map(specifier);
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
    const names = preserved.map((specifier) =>
      specifier.imported.name === specifier.local.name
        ? specifier.local.name
        : `${specifier.imported.name} as ${specifier.local.name}`,
    );
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
 * Un-indexed PascalCase names get a guessed path by default. Pass
 * `{ optimistic: false }` to skip that. See {@link OptimizeImportsOptions.optimistic}.
 */
export const optimizeImports: SveltePreprocessor<
  "script",
  OptimizeImportsOptions
> = (options) => {
  const optimistic = options?.optimistic ?? true;

  return {
    name: "carbon:optimize-imports",
    script({ filename, content: raw }) {
      // Skip files in node_modules to minimize unnecessary preprocessing
      if (!filename) return;
      if (NODE_MODULES_REGEX.test(filename)) return;

      /**
       * The Svelte compiler's parse() function expects a full Svelte component,
       * not just a script fragment. Wrap the raw script content in script tags
       * to make it parseable, then strip the tags from output after transformation.
       */
      const content = `<script lang="ts">${raw}</script>`;
      const s = new MagicString(content);

      walk(parse(content), {
        enter(node) {
          if (node.type === "ImportDeclaration") {
            const import_name = node.source.value;

            switch (import_name) {
              case CarbonSvelte.Components:
                rewriteImport(s, node, ({ imported, local }) => {
                  // Prefer indexed path (handles .js and other special cases).
                  const import_path = components[imported.name]?.path;
                  if (import_path) {
                    return `import ${local.name} from "${import_path}";`;
                  }

                  // Not in index. When optimistic (the default), guess a src/
                  // path for PascalCase names so newer carbon-components-svelte
                  // releases work without re-indexing/upgrading this preprocessor
                  // (see #97); a genuinely non-existent name surfaces as a
                  // downstream resolution error. camelCase names are utilities,
                  // not .svelte files, so they always stay on the barrel.
                  if (optimistic && COMPONENT_NAME_REGEX.test(imported.name)) {
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
        },
      });

      s.replace(SCRIPT_OPEN_TAG_REGEX, "").replace(SCRIPT_CLOSE_TAG_REGEX, "");

      return {
        code: s.toString(),
        map: s.generateMap({ source: filename, hires: true }),
      };
    },
  };
};
