import { type PackageExport, readPackageExports } from "svelte-prune/internal";
import { CarbonSvelte } from "../constants";

// Follows re-export chains to the module that defines each name, since
// older releases go through each folder's `index.js`
// (`export { Button } from "./Button"`), and newer ones point straight at
// the `.svelte` file.
export function readCarbonExports(
  carbonRoot: string,
): Map<string, PackageExport> {
  return readPackageExports(carbonRoot, {
    name: CarbonSvelte.Components,
    srcDir: "src",
    barrel: "index.js",
  });
}
