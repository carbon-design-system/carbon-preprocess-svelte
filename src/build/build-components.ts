import { parse } from "path";
import { totalist } from "totalist";
import { getPackageJson, writeFile } from "../utils";
import { CARBON_SVELTE, API_COMPONENTS } from "../constants";
import { BuildApi } from "../build";

export interface BuildComponents extends BuildApi {
  components: Record<string, { path: string }>;
}

(async () => {
  const pkg = getPackageJson("node_modules/carbon-components-svelte");
  const components: BuildComponents = {
    metadata: {
      package: pkg.name!,
      version: pkg.version!,
    },
    components: {},
  };

  await totalist(`node_modules/${CARBON_SVELTE.components}/src`, (file) => {
    if (/\.svelte$/.test(file)) {
      const moduleName = parse(file).name;
      const path = `${CARBON_SVELTE.components}/src/${file}`;
      components.components[moduleName] = { path };
    }
  });

  await writeFile(
    API_COMPONENTS,
    `export const components = ${JSON.stringify(components, null, 2)}`
  );
})();
