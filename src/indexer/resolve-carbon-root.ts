import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { CarbonSvelte } from "../constants";

const nodeRequire = createRequire(import.meta.url);

/**
 * Directory of the installed `carbon-components-svelte` package.
 *
 * Searched from the consuming project first (`from`, defaulting to the
 * working directory), then from this package's own install location. The
 * project has to come first: in a monorepo where this package is hoisted to
 * the root but Carbon is installed only under the app, a search anchored on
 * `import.meta.url` never sees the app's `node_modules`.
 *
 * Deliberately doesn't `require.resolve("carbon-components-svelte/package.json")`
 * (or any subpath): Carbon's `exports` map only declares conditional entries
 * for `.`, `./css/*.css`, and `./src/*`, so a plain Node subpath resolution
 * for `package.json` throws (`ERR_PACKAGE_PATH_NOT_EXPORTED`) even though the
 * file is right there on disk. `require.resolve.paths` returns the ordinary
 * `node_modules` search path list -- the pre-`exports` algorithm -- so it
 * isn't subject to that gate.
 */
export function resolveCarbonRoot(from: string = process.cwd()): string {
  // `createRequire` wants a module filename; it need not exist on disk.
  const projectRequire = createRequire(path.join(from, "__resolve__.js"));
  const searchPaths = new Set([
    ...(projectRequire.resolve.paths(CarbonSvelte.Components) ?? []),
    ...(nodeRequire.resolve.paths(CarbonSvelte.Components) ?? []),
  ]);

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
