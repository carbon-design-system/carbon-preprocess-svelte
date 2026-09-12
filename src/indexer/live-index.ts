import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { version as OWN_VERSION } from "../../package.json";
import type { ComponentIndex } from "./build-index";
import { buildComponentIndex, resolveCarbonRoot } from "./build-index";

const LOG_PREFIX = "[carbon-preprocess-svelte]";

const CACHE_DIRNAME = ".cache/carbon-preprocess-svelte";

async function readCarbonVersion(carbonRoot: string): Promise<string> {
  const pkg = JSON.parse(
    await readFile(path.join(carbonRoot, "package.json"), "utf8"),
  );
  return typeof pkg.version === "string" ? pkg.version : "unknown";
}

/**
 * Structural check on whatever came off disk. `JSON.parse` succeeding is not
 * enough: an empty object or a differently-shaped file would be handed to
 * `optimizeCss` as an empty allowlist and silently prune every Carbon rule.
 */
export function isComponentIndex(value: unknown): value is ComponentIndex {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const entries = Object.values(value);
  if (entries.length === 0) return false;

  return entries.every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { path?: unknown }).path === "string" &&
      Array.isArray((entry as { classes?: unknown }).classes) &&
      (entry as { classes: unknown[] }).classes.every(
        (cls) => typeof cls === "string",
      ),
  );
}

async function readCache(
  cacheFile: string,
): Promise<ComponentIndex | undefined> {
  try {
    const parsed = JSON.parse(await readFile(cacheFile, "utf8"));
    return isComponentIndex(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Best-effort, atomic: a sibling temp file is renamed into place so a
 * concurrent build (e.g. parallel client/server builds sharing one
 * `node_modules`) never observes a half-written file. A failed write just
 * means the next build re-indexes.
 */
async function writeCache(
  cacheFile: string,
  index: ComponentIndex,
): Promise<void> {
  const tmpFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
  try {
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(tmpFile, JSON.stringify(index));
    await rename(tmpFile, cacheFile);
  } catch {
    await rm(tmpFile, { force: true }).catch(() => {});
  }
}

export type LiveIndexOptions = {
  /** Directory the installed `carbon-components-svelte` is resolved from. */
  projectRoot?: string;
};

/**
 * Cache file for one (Carbon version, preprocessor version) pair under the
 * consuming project's `node_modules/.cache/carbon-preprocess-svelte/`.
 * Keyed by both so a bump on either side misses and rebuilds: a new Carbon
 * changes the input, a new preprocessor may change the extraction.
 */
export function liveIndexCacheFile(
  carbonRoot: string,
  carbonVersion: string,
): string {
  return path.join(
    path.dirname(carbonRoot),
    CACHE_DIRNAME,
    `${carbonVersion}_${OWN_VERSION}.json`,
  );
}

/**
 * Builds (or reads a cached copy of) the component index for whichever
 * `carbon-components-svelte` is actually installed in the consuming project
 * -- no waiting on this library to re-publish its frozen index after a
 * Carbon bump.
 */
export async function resolveLiveComponentIndex(
  options?: LiveIndexOptions,
): Promise<ComponentIndex> {
  const carbonRoot = resolveCarbonRoot(options?.projectRoot);
  const version = await readCarbonVersion(carbonRoot);
  const cacheFile = liveIndexCacheFile(carbonRoot, version);

  const cached = await readCache(cacheFile);
  if (cached) return cached;

  const index = await buildComponentIndex({ carbonRoot });

  if (!isComponentIndex(index)) {
    throw new Error(
      `Indexed "${carbonRoot}" but found no exported components; unexpected package layout.`,
    );
  }

  await writeCache(cacheFile, index);
  return index;
}

/**
 * Un-memoized `ensureLiveComponentIndex`: resolves the live index, falling
 * back to the bundled static `component-index.ts` on any failure
 * (unresolvable `carbon-components-svelte`, unexpected Carbon `src` layout,
 * etc.) so opting in can't turn a working build into a broken one.
 */
export async function loadLiveComponentIndex(
  options?: LiveIndexOptions,
): Promise<ComponentIndex> {
  try {
    return await resolveLiveComponentIndex(options);
  } catch (error) {
    console.warn(
      `${LOG_PREFIX} experimental.liveIndex: falling back to the bundled static component index (${(error as Error)?.message ?? error}).`,
    );
    const { components } = await import("../component-index");
    return components;
  }
}

let memoized: Promise<ComponentIndex> | undefined;

/**
 * Memoized per build process: every plugin instance that opts into
 * `experimental.liveIndex: true` triggers at most one indexing pass (or
 * cache read), no matter how many `optimizeImports`/`optimizeCss` instances
 * request it.
 */
export function ensureLiveComponentIndex(): Promise<ComponentIndex> {
  memoized ??= loadLiveComponentIndex();
  return memoized;
}
