import path from "path";
import fs from "fs";
import { totalist } from "totalist";
import { parse, walk } from "svelte/compiler";
import { getPackageJson, writeFile } from "../utils";
import { CARBON_SVELTE, API_COMPONENTS } from "../constants";
import type { BuildApi } from "../build";
import type { Node } from "../walk-and-replace";

type ExportName = string;

interface BuildComponentsApi {
  path: string;
}
export interface BuildComponents extends BuildApi {
  components: Record<ExportName, BuildComponentsApi>;
}

(async () => {
  const pkg = getPackageJson("node_modules/carbon-components-svelte");
  const components: BuildComponents = {
    metadata: {
      package: pkg.name!,
      version: pkg.version!,
      exports: 0,
    },
    components: {},
  };

  const indexJs = fs.readFileSync(
    `node_modules/${CARBON_SVELTE.components}/src/index.js`,
    "utf-8"
  );
  const ast = parse(`<script>${indexJs}</script>`);
  const exports = new Set();

  walk(ast, {
    enter(node: Node) {
      if (node.type === "Identifier") {
        exports.add(node.name);
      }
    },
  });

  components.metadata.exports = exports.size;

  const moduleNames = new Map<ExportName, BuildComponentsApi>();

  await totalist(`node_modules/${CARBON_SVELTE.components}/src`, (file) => {
    const moduleName = path.parse(file).name;

    if (exports.has(moduleName)) {
      const path = `${CARBON_SVELTE.components}/src/${file}`;
      moduleNames.set(moduleName, { path });
    }
  });

  [...moduleNames.entries()].sort().forEach(([moduleName, value]) => {
    components.components[moduleName] = value;
  });

  await writeFile(
    API_COMPONENTS,
    `export const components = ${JSON.stringify(components, null, 2)}`
  );
})();
