import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const nodeRequire = createRequire(import.meta.url);

/**
 * Same search strategy as `resolveCarbonRoot`, parameterized by package name
 * so tests can locate the `npm:`-aliased real-version fixtures (e.g.
 * `carbon-components-svelte-old`/`-next`) instead of the real
 * `carbon-components-svelte` devDependency.
 */
export function resolvePackageRoot(packageName: string): string {
  const searchPaths = nodeRequire.resolve.paths(packageName) ?? [];

  for (const base of searchPaths) {
    const candidate = path.join(base, packageName);
    if (existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }

  throw new Error(`Could not resolve installed package "${packageName}".`);
}
