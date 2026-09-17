import { CarbonSvelte } from "../constants";
import type { ComponentIndex } from "../indexer/build-index";

/**
 * Compact on-disk encoding for the generated component index. The index is
 * ~70% of the published bundle when stored as plain JSON, so it is packed
 * into four strings that `decodeComponentIndex` expands once at module load:
 *
 * - `pool`: every distinct class, sorted, front-coded: each entry is one
 *   char (`'0'` + the number of leading chars shared with the previous
 *   entry) followed by the rest of the name. `.bx--` is dropped, so an entry
 *   that still starts with `.` is a non-Carbon selector stored verbatim.
 * - `names`: component identifiers, in order.
 * - `paths`: per component, its file relative to `carbon-components-svelte/src`.
 *   `Dir/Name.svelte` collapses to `Dir`, and `Name/Name.svelte` to `""`,
 *   since almost every component follows that layout.
 * - `classes`: per component, its pool indexes as VLQ-encoded gaps (each
 *   index minus the previous one, minus 1), using the source-map base64
 *   alphabet. Class lists are sorted like the pool, so gaps are small.
 *
 * Entries within each string are separated by `,`, which never occurs in a
 * class name, identifier, or path.
 */
export type EncodedComponentIndex = {
  pool: string;
  names: string;
  paths: string;
  classes: string;
};

const SEPARATOR = ",";
const CARBON_CLASS_PREFIX = ".bx--";
const PATH_PREFIX = `${CarbonSvelte.Components}/src/`;
const SHARED_PREFIX_BASE = 48; // '0'
const MAX_SHARED_PREFIX = 74; // '0' + 74 = 'z', keeps the length char printable
const VLQ_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const VLQ_BASE_SHIFT = 5;
const VLQ_BASE_MASK = 31;
const VLQ_CONTINUATION_BIT = 32;

function encodeVlq(value: number): string {
  let out = "";
  let rest = value;
  do {
    let digit = rest & VLQ_BASE_MASK;
    rest >>>= VLQ_BASE_SHIFT;
    if (rest > 0) digit |= VLQ_CONTINUATION_BIT;
    out += VLQ_ALPHABET[digit];
  } while (rest > 0);
  return out;
}

function encodePath(identifier: string, fullPath: string): string {
  if (!fullPath.startsWith(PATH_PREFIX)) {
    throw new Error(
      `Component "${identifier}" path "${fullPath}" is not under ${PATH_PREFIX}.`,
    );
  }
  const relative = fullPath.slice(PATH_PREFIX.length);
  const slash = relative.indexOf("/");
  if (slash !== -1 && relative.lastIndexOf("/") === slash) {
    const dir = relative.slice(0, slash);
    if (relative.slice(slash + 1) === `${identifier}.svelte`) {
      return dir === identifier ? "" : dir;
    }
  }
  return relative;
}

function decodePath(identifier: string, encoded: string): string {
  if (encoded === "") {
    return `${PATH_PREFIX}${identifier}/${identifier}.svelte`;
  }
  if (!encoded.includes("/")) {
    return `${PATH_PREFIX}${encoded}/${identifier}.svelte`;
  }
  return PATH_PREFIX + encoded;
}

function encodePool(pool: readonly string[]): string {
  const out: string[] = [];
  let previous = "";
  for (const name of pool) {
    const stripped = name.startsWith(CARBON_CLASS_PREFIX)
      ? name.slice(CARBON_CLASS_PREFIX.length)
      : name;
    if (stripped === "" || stripped.includes(SEPARATOR)) {
      throw new Error(`Cannot encode class "${name}".`);
    }
    // A stripped Carbon class never starts with "." and a verbatim selector
    // always does; the decoder relies on that to know which prefix to restore.
    if (stripped.startsWith(".") !== !name.startsWith(CARBON_CLASS_PREFIX)) {
      throw new Error(`Cannot encode class "${name}".`);
    }
    let shared = 0;
    while (
      shared < MAX_SHARED_PREFIX &&
      shared < previous.length &&
      shared < stripped.length &&
      previous.charCodeAt(shared) === stripped.charCodeAt(shared)
    ) {
      shared++;
    }
    out.push(
      String.fromCharCode(SHARED_PREFIX_BASE + shared) + stripped.slice(shared),
    );
    previous = stripped;
  }
  return out.join(SEPARATOR);
}

function decodePool(encoded: string): string[] {
  const pool: string[] = [];
  let previous = "";
  for (const entry of encoded.split(SEPARATOR)) {
    const shared = entry.charCodeAt(0) - SHARED_PREFIX_BASE;
    const stripped = previous.slice(0, shared) + entry.slice(1);
    pool.push(
      stripped.charCodeAt(0) === 46 /* . */
        ? stripped
        : CARBON_CLASS_PREFIX + stripped,
    );
    previous = stripped;
  }
  return pool;
}

export function encodeComponentIndex(
  components: ComponentIndex,
): EncodedComponentIndex {
  const entries = Object.entries(components);
  const pool = [...new Set(entries.flatMap(([, entry]) => entry.classes))].sort(
    (a, b) => a.localeCompare(b),
  );
  const poolIndex = new Map(pool.map((name, i) => [name, i]));

  const names: string[] = [];
  const paths: string[] = [];
  const classes: string[] = [];

  for (const [identifier, entry] of entries) {
    if (identifier.includes(SEPARATOR) || entry.path.includes(SEPARATOR)) {
      throw new Error(`Cannot encode component "${identifier}".`);
    }
    // Gaps must be non-negative, so each list is stored in pool order.
    const indexes = entry.classes
      .map((name) => poolIndex.get(name) as number)
      .sort((a, b) => a - b);
    let encoded = "";
    let previous = -1;
    for (const index of indexes) {
      encoded += encodeVlq(index - previous - 1);
      previous = index;
    }
    names.push(identifier);
    paths.push(encodePath(identifier, entry.path));
    classes.push(encoded);
  }

  return {
    pool: encodePool(pool),
    names: names.join(SEPARATOR),
    paths: paths.join(SEPARATOR),
    classes: classes.join(SEPARATOR),
  };
}

export function decodeComponentIndex(
  encoded: EncodedComponentIndex,
): ComponentIndex {
  const pool = decodePool(encoded.pool);
  const names = encoded.names.split(SEPARATOR);
  const paths = encoded.paths.split(SEPARATOR);
  const classLists = encoded.classes.split(SEPARATOR);
  const components: ComponentIndex = {};

  for (let i = 0; i < names.length; i++) {
    const identifier = names[i];
    const list = classLists[i];
    const classes: string[] = [];
    let index = -1;
    let value = 0;
    let shift = 0;

    for (let j = 0; j < list.length; j++) {
      const digit = VLQ_ALPHABET.indexOf(list[j]);
      value += (digit & VLQ_BASE_MASK) << shift;
      if (digit & VLQ_CONTINUATION_BIT) {
        shift += VLQ_BASE_SHIFT;
        continue;
      }
      index += value + 1;
      classes.push(pool[index]);
      value = 0;
      shift = 0;
    }

    components[identifier] = {
      path: decodePath(identifier, paths[i]),
      classes,
    };
  }

  return components;
}
