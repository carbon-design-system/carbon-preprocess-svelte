import MagicString from "magic-string";
import { parse, walk } from "svelte/compiler";
import type { SveltePreprocessor } from "svelte/types/compiler/preprocess";
import { components } from "./components";
import { CarbonSvelte } from "./constants";
import { rewriteImport } from "./utils";

export const optimizeImports: SveltePreprocessor<"script"> = () => {
  return {
    name: "optimize-imports",
    script({ filename, content }) {
      // Skip Svelte files in node_modules to minimize unnecessary preprocessing
      if (filename && /node_modules/.test(filename)) return;

      const s = new MagicString(content);

      walk(parse(content), {
        enter(node) {
          if (node.type === "ImportDeclaration") {
            const import_name = node.source.value;

            switch (import_name) {
              case CarbonSvelte.Components:
                rewriteImport(s, node, ({ imported, local }) => {
                  const import_path = components[imported.name];
                  return import_path
                    ? `import ${local.name} from "${import_path}";`
                    : "";
                });
                break;

              case CarbonSvelte.Icons:
              case CarbonSvelte.Pictograms:
                rewriteImport(s, node, ({ imported, local }) => {
                  return `import ${local.name} from "${import_name}/${imported.name}.svelte";`;
                });
                break;
            }
          }
        },
      });

      return {
        code: s.toString(),
        map: s.generateMap({ source: filename, hires: true }),
      };
    },
  };
};
