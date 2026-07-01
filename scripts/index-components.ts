import { Glob } from "bun";
import { buildComponentIndex } from "../src/indexer/build-index";

/**
 * Proven exceptions when automation misses on a Carbon bump. Prefer updating
 * extract-runtime-classes / extract-css-context gates before adding here.
 */
const MANUAL_OVERRIDES: Record<string, string[]> = {};

const debugIndex = process.env.DEBUG_INDEX === "1";

/**
 * Bun's `Glob` scan order is what the committed `component-index.ts` was
 * generated with -- the multi-level sub-component class merge in
 * `buildComponentIndex` is scan-order sensitive, so keeping this the same
 * lister keeps regeneration reproducible. See the `listFiles` doc comment
 * on `buildComponentIndex` for why the live-index runtime path (which can't
 * depend on Bun) uses a different, Node-native lister instead.
 */
async function listFilesViaBunGlob(carbonSrc: string): Promise<string[]> {
  const files: string[] = [];
  for await (const file of new Glob("**/*.{js,svelte}").scan(carbonSrc)) {
    files.push(file);
  }
  return files;
}

const components = await buildComponentIndex({
  listFiles: listFilesViaBunGlob,
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
