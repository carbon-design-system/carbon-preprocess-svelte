import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { CarbonSvelte } from "../constants";

const nodeRequire = createRequire(import.meta.url);

/**
 * Directory of the installed `carbon-components-svelte` package.
 *
 * Deliberately doesn't `require.resolve("carbon-components-svelte/package.json")`
 * (or any subpath): Carbon's `exports` map only declares conditional entries
 * for `.`, `./css/*.css`, and `./src/*`, so a plain Node subpath resolution
 * for `package.json` throws (`ERR_PACKAGE_PATH_NOT_EXPORTED`) even though the
 * file is right there on disk. `require.resolve.paths` returns the ordinary
 * `node_modules` search path list -- the pre-`exports` algorithm -- so it
 * isn't subject to that gate.
 */
export function resolveCarbonRoot(): string {
  const searchPaths = nodeRequire.resolve.paths(CarbonSvelte.Components) ?? [];

  for (const base of searchPaths) {
    const candidate = path.join(base, CarbonSvelte.Components);
    if (existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }

  throw new Error(
    `Could not resolve an installed "${CarbonSvelte.Components}" package.`,
  );
}
