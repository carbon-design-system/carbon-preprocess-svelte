import { Glob } from "bun";
import path from "node:path";
import { parse, walk } from "svelte/compiler";
import { CarbonSvelte } from "../src/constants";
import { isSvelteFile } from "../src/utils";
import { extractSelectors } from "./extract-selectors";

const carbon_path = path.join("node_modules", CarbonSvelte.Components);
const index_js = path.join(carbon_path, "src/index.js");
const index_file = await Bun.file(index_js).text();

/**
 * The exportee from `carbon-components-svelte`.
 * @example Accordion, breakpoints, etc.
 */
type Identifier = string;

type IdentifierValue = { path: string; classes: string[] };

const exports_map = new Map<Identifier, null | IdentifierValue>();

walk(parse(`<script>${index_file}</script>`), {
  enter(node) {
    if (node.type === "Identifier") {
      exports_map.set(node.name, null);
    }
  },
});

const files = new Glob("**/*.{js,svelte}").scan(path.join(carbon_path, "src"));

for await (const file of files) {
  const moduleName = path.parse(file).name;

  if (exports_map.has(moduleName)) {
    const map: IdentifierValue = {
      path: `${CarbonSvelte.Components}/src/${file}`,
      classes: [],
    };

    if (isSvelteFile(file)) {
      const file_path = path.join(carbon_path, "src/", file);
      const file_text = await Bun.file(file_path).text();
      map.classes = extractSelectors({ code: file_text, filename: file });
    }

    exports_map.set(moduleName, map);
  }
}

// Sort Map keys alphabetically and convert to object.
const components = Object.fromEntries(
  new Map(
    [...exports_map.entries()]
      .sort((a, b) => a.toLocaleString().localeCompare(b.toLocaleString()))
      .filter(([_, value]) => value !== null),
  ),
);

await Bun.write(
  "src/component-index.ts",
  `// @generated
// This file was automatically generated and should not be edited.
// @see scripts/index-components.ts
// prettier-ignore

export const components: Record<string, { path: string; classes: string[]; }> = Object.freeze(${JSON.stringify(
    components,
  )});\n`,
);
