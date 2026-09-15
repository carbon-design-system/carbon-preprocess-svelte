const BARREL_IMPORT =
  /import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']carbon-components-svelte["']/g;
const DIRECT_IMPORT =
  /["']carbon-components-svelte\/src\/[^"']*?\/([A-Za-z0-9_]+)\.svelte["']/g;
const TYPE_PREFIX = /^type\s+/;
const AS_ALIAS = /\s+as\s+/;

/**
 * Add the Carbon component names imported by `source` to `into`. Handles
 * both the barrel form and the direct-path form `optimizeImports` produces.
 * Type-only imports are skipped.
 */
export function collectCarbonImports(source: string, into: Set<string>): void {
  if (!source.includes("carbon-components-svelte")) return;

  for (const match of source.matchAll(BARREL_IMPORT)) {
    if (match[1]) continue;

    for (const raw of match[2].split(",")) {
      const specifier = raw.trim();
      if (!specifier || TYPE_PREFIX.test(specifier)) continue;
      const name = specifier.split(AS_ALIAS)[0].trim();
      if (name) into.add(name);
    }
  }

  for (const match of source.matchAll(DIRECT_IMPORT)) {
    into.add(match[1]);
  }
}
