import {
  decodeComponentIndex,
  encodeComponentIndex,
} from "../src/component-index/codec";
import { buildComponentIndex } from "../src/indexer/build-index";
import { diffComponentIndex } from "./diff-component-index";

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

// The index is written in the compact form described in
// src/component-index/codec.ts and expanded once at module load, so the
// exported `components` shape stays `{ path: string; classes: string[] }`.
const encoded = encodeComponentIndex(components);

// The encoding is lossless only for an index whose class lists are sorted
// the way `buildComponentIndex` sorts them, so prove the round trip before
// writing anything.
const decoded = decodeComponentIndex(encoded);
if (JSON.stringify(decoded) !== JSON.stringify(components)) {
  throw new Error(
    "Encoded component index does not round-trip; see src/component-index/codec.ts.",
  );
}

// The packed file's git diff says nothing useful, so report what actually
// changed against the checked-in index (best effort: a missing or broken
// file just skips the report).
const previous = await import("../src/component-index/index")
  .then((module) => module.components)
  .catch(() => undefined);
if (previous) {
  const diff = diffComponentIndex(previous, decoded);
  console.log(
    diff.length === 0
      ? "[index] no changes"
      : ["[index] changes:", ...diff.map((line) => `[index] ${line}`)].join(
          "\n",
        ),
  );
}

await Bun.write(
  "src/component-index/index.ts",
  `// @generated
// This file was automatically generated and should not be edited.
// @see scripts/index-components.ts

import { decodeComponentIndex } from "./codec";

// Compact encoding of every component's path and CSS classes; see
// src/component-index/codec.ts for the format.
export const components = Object.freeze(
  decodeComponentIndex({
    pool: ${JSON.stringify(encoded.pool)},
    names: ${JSON.stringify(encoded.names)},
    paths: ${JSON.stringify(encoded.paths)},
    classes: ${JSON.stringify(encoded.classes)},
  }),
);\n`,
);
