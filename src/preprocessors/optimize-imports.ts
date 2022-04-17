import { PreprocessorGroup } from "svelte/types/compiler/preprocess";
import { walkAndReplace } from "../walk-and-replace";
import { BuildComponents } from "../build/build-components";
import { getCarbonVersions } from "../utils";
import { CARBON_SVELTE } from "../constants";
import { components } from "../carbon-components-svelte.js";

const Components: Pick<BuildComponents, "components"> = components;
const CARBON_VERSIONS: Record<string, string> = getCarbonVersions();

export function optimizeImports(): Pick<PreprocessorGroup, "script"> {
  return {
    script({ filename, content }) {
      if (filename && !/node_modules/.test(filename)) {
        const code = walkAndReplace(
          {
            type: "script",
            content,
            filename,
          },
          ({ node }, replaceContent) => {
            if (node.type === "ImportDeclaration") {
              switch (node.source.value) {
                case CARBON_SVELTE.components:
                  replaceContent(
                    node,
                    node.specifiers
                      .map(({ local, imported }) => {
                        if (imported.name in Components.components) {
                          return `import ${local.name} from "${
                            Components.components[imported.name].path
                          }";`;
                        }

                        console.warn(
                          `[carbon:optimizeImports] ${imported.name} is not a valid Carbon component`
                        );
                        return "";
                      })
                      .join("\n")
                  );
                  break;

                case CARBON_SVELTE.icons:
                  replaceContent(
                    node,
                    node.specifiers
                      .map(({ local, imported }) => {
                        if (CARBON_VERSIONS[CARBON_SVELTE.icons] === "11") {
                          return `import ${local.name} from "${CARBON_SVELTE.icons}/lib/${imported.name}.svelte";`;
                        }

                        return `import ${local.name} from "${CARBON_SVELTE.icons}/lib/${imported.name}/${imported.name}.svelte";`;
                      })
                      .join("\n")
                  );
                  break;

                case CARBON_SVELTE.pictograms:
                  replaceContent(
                    node,
                    node.specifiers
                      .map(({ local, imported }) => {
                        if (
                          CARBON_VERSIONS[CARBON_SVELTE.pictograms] === "11" ||
                          CARBON_VERSIONS[CARBON_SVELTE.pictograms] === "12"
                        ) {
                          return `import ${local.name} from "${CARBON_SVELTE.pictograms}/lib/${imported.name}.svelte";`;
                        }

                        return `import ${local.name} from "${CARBON_SVELTE.pictograms}/lib/${imported.name}/${imported.name}.svelte";`;
                      })
                      .join("\n")
                  );
                  break;
              }
            }
          }
        );

        return { code };
      }

      return { code: content };
    },
  };
}

// alias to make it compatible with the old preprocessor
export { optimizeImports as optimizeCarbonImports };
