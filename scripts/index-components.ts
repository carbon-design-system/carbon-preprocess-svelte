import { buildComponentIndex } from "../src/indexer/build-index";

/**
 * Proven exceptions when automation misses on a Carbon bump. Prefer updating
 * extract-runtime-classes / extract-css-context gates before adding here.
 */
const MANUAL_OVERRIDES: Record<string, string[]> = {};

const debugIndex = process.env.DEBUG_INDEX === "1";

const components = await buildComponentIndex({
  onTiming: debugIndex
    ? (label, ms) => console.log(`[index] ${label}: ${ms.toFixed(0)}ms`)
    : undefined,
});

for (const [identifier, classes] of Object.entries(MANUAL_OVERRIDES)) {
  const entry = components[identifier];
  if (entry) {
    entry.classes = [...new Set([...entry.classes, ...classes])].sort((a, b) =>
      a.localeCompare(b),
    );
  }
}

const isBuild = process.env.BUILD === "true";
const jsonString = isBuild
  ? JSON.stringify(components)
  : JSON.stringify(components, null, 2);

await Bun.write(
  "src/component-index.ts",
  `// @generated
// This file was automatically generated and should not be edited.
// @see scripts/index-components.ts

export const components: Record<string, { path: string; classes: string[]; }> = Object.freeze(${jsonString});\n`,
);
