import MagicString from "magic-string";
import { parse, walk, type ImportDeclaration } from "svelte/compiler";
import type { SveltePreprocessor } from "svelte/types/compiler/preprocess";
import { components } from "./component-index";
import { CarbonSvelte } from "./constants";

function rewriteImport(
  s: MagicString,
  node: ImportDeclaration,
  map: (specifier: ImportDeclaration["specifiers"][0]) => string
) {
  let content = "";

  for (const specifier of node.specifiers) {
    const fragment = map(specifier);
    if (fragment) content += fragment;
  }

  if (content) s.overwrite(node.start, node.end, content);
}

export const optimizeImports: SveltePreprocessor<"script"> = () => {
  return {
    name: "carbon:optimize-imports",
    script({ filename, content: raw }) {
      // Skip Svelte files in node_modules to minimize unnecessary preprocessing
      if (!filename) return;
      if (/node_modules/.test(filename)) return;

      // Wrap the content in a `<script>` tag to parse it with the Svelte parser.
      const content = `<script>${raw}</script>`;
      const s = new MagicString(content);

      walk(parse(content), {
        enter(node) {
          if (node.type === "ImportDeclaration") {
            const import_name = node.source.value;

            switch (import_name) {
              case CarbonSvelte.Components:
                rewriteImport(s, node, ({ imported, local }) => {
                  const import_path = components[imported.name]?.path;
                  return import_path
                    ? `import ${local.name} from "${import_path}";`
                    : "";
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

      s.replace(/^<script>/, "");
      s.replace(/<\/script>$/, "");

      return {
        code: s.toString(),
        map: s.generateMap({ source: filename, hires: true }),
      };
    },
  };
};
