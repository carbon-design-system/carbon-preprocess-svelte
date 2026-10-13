import { CarbonSvelte } from "../constants";
import { type PackageExport, readPackageExports } from "../specializer/exports";

/**
 * Maps every name exported by `carbon-components-svelte`'s `src/index.js` to
 * the module that defines it, following re-export chains: older releases go
 * through each folder's `index.js` (`export { Button } from "./Button"`),
 * newer ones point straight at the `.svelte` file.
 */
export function readCarbonExports(
  carbonRoot: string,
): Map<string, PackageExport> {
  return readPackageExports(carbonRoot, {
    name: CarbonSvelte.Components,
    srcDir: "src",
    barrel: "index.js",
  });
}
