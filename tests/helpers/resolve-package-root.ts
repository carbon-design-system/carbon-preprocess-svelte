import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

// Literal specifier so the `npm:` alias is a real dependency reference.
// Node rejects `./package.json` (it isn't in Carbon's exports map); Bun accepts it.
let carbonComponentsSvelteOldPackageJson: string | undefined;
try {
  carbonComponentsSvelteOldPackageJson = require.resolve(
    "carbon-components-svelte-old/package.json",
  );
} catch {
  carbonComponentsSvelteOldPackageJson = undefined;
}

/**
 * Same search strategy as `resolveCarbonRoot`, parameterized by package name
 * so tests can locate the `npm:`-aliased real-version fixtures (e.g.
 * `carbon-components-svelte-old`/`-next`) instead of the real
 * `carbon-components-svelte` devDependency.
 */
export function resolvePackageRoot(packageName: string): string {
  if (
    packageName === "carbon-components-svelte-old" &&
    carbonComponentsSvelteOldPackageJson
  ) {
    return path.dirname(carbonComponentsSvelteOldPackageJson);
  }

  const searchPaths = require.resolve.paths(packageName) ?? [];

  for (const base of searchPaths) {
    const candidate = path.join(base, packageName);
    if (existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }

  throw new Error(`Could not resolve installed package "${packageName}".`);
}
