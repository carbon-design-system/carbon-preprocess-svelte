import { Glob } from "bun";
import path from "node:path";
import { parse, walk } from "svelte/compiler";
import { CarbonSvelte } from "../src/constants";

const carbon_path = path.join("node_modules", CarbonSvelte.Components);
const index_js = path.join(carbon_path, "src/index.js");
const index_file = await Bun.file(index_js).text();

type Identifier = string;

const exports_map = new Map<Identifier, null | string>();

walk(parse(`<script>${index_file}</script>`), {
  enter(node) {
    if (node.type === "Identifier") {
      exports_map.set(node.name, null);
    }
  },
});

const files = new Glob("**/*.svelte").scan(path.join(carbon_path, "src"));

for await (const file of files) {
  const moduleName = path.parse(file).name;

  if (exports_map.has(moduleName)) {
    exports_map.set(moduleName, `${CarbonSvelte.Components}/src/${file}`);
  }
}

// Sort Map keys alphabetically and convert to object.
const components = Object.fromEntries(
  new Map(
    [...exports_map.entries()]
      .sort((a, b) => a.toLocaleString().localeCompare(b.toLocaleString()))
      .filter(([_, value]) => value !== null)
  )
);

await Bun.write(
  `src/components.ts`,
  `// @generated
// This file was automatically generated and should not be edited.
// @see scripts/parser.ts
// prettier-ignore

export const components: Record<string, string> = ${JSON.stringify(
    components,
    null,
    2
  )};\n`
);
