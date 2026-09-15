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

// Class names repeat heavily across components (e.g. `.bx--skeleton` shows up
// in dozens of *Skeleton components), so entries are encoded as indexes into
// a deduplicated pool instead of repeating each string per component. This
// keeps the exported `components` shape identical (`classes: string[]`);
// only the on-disk encoding changes.
const classPool = [
  ...new Set(Object.values(components).flatMap((c) => c.classes)),
].sort((a, b) => a.localeCompare(b));
const classIndex = new Map(classPool.map((name, i) => [name, i]));

function toClassIndex(name: string): number {
  const index = classIndex.get(name);
  if (index === undefined) {
    throw new Error(`Class "${name}" missing from generated class pool.`);
  }
  return index;
}

const entries: Record<string, { path: string; classes: number[] }> =
  Object.fromEntries(
    Object.entries(components).map(([identifier, entry]) => [
      identifier,
      {
        path: entry.path,
        classes: entry.classes.map(toClassIndex),
      },
    ]),
  );

const isBuild = process.env.BUILD === "true";
const classPoolString = isBuild
  ? JSON.stringify(classPool)
  : JSON.stringify(classPool, null, 2);
const entriesString = isBuild
  ? JSON.stringify(entries)
  : JSON.stringify(entries, null, 2);

await Bun.write(
  "src/component-index.ts",
  `// @generated
// This file was automatically generated and should not be edited.
// @see scripts/index-components.ts

// Deduplicated pool of CSS class names referenced by index below, since the
// same classes (e.g. ".bx--skeleton") are shared across many components.
const classPool: string[] = ${classPoolString};

const entries: Record<string, { path: string; classes: number[] }> = ${entriesString};

export const components: Record<string, { path: string; classes: string[] }> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(entries).map(([identifier, entry]) => [
        identifier,
        {
          path: entry.path,
          classes: entry.classes.map((i) => classPool[i]),
        },
      ]),
    ),
  );\n`,
);
