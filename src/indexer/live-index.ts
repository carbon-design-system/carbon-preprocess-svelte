import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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

async function readCache(
  cacheFile: string,
): Promise<ComponentIndex | undefined> {
  try {
    return JSON.parse(await readFile(cacheFile, "utf8"));
  } catch {
    return undefined;
  }
}

async function writeCache(
  cacheDir: string,
  cacheFile: string,
  index: ComponentIndex,
): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cacheFile, JSON.stringify(index));
  } catch {
    // Best-effort: a stale/missing cache just means the next build re-indexes.
  }
}

/**
 * Builds (or reads a cached copy of) the component index for whichever
 * `carbon-components-svelte` is actually installed in the consuming project
 * -- no waiting on this library to re-publish its frozen index after a
 * Carbon bump.
 *
 * Cached at `node_modules/.cache/carbon-preprocess-svelte/<version>.json`,
 * keyed by the installed version so a Carbon bump invalidates the cache
 * automatically (a new version simply misses and rebuilds).
 */
export async function resolveLiveComponentIndex(): Promise<ComponentIndex> {
  const carbonRoot = resolveCarbonRoot();
  const version = await readCarbonVersion(carbonRoot);
  const cacheDir = path.join(path.dirname(carbonRoot), CACHE_DIRNAME);
  const cacheFile = path.join(cacheDir, `${version}.json`);

  const cached = await readCache(cacheFile);
  if (cached) return cached;

  const index = await buildComponentIndex({ carbonRoot });
  await writeCache(cacheDir, cacheFile, index);
  return index;
}

let memoized: Promise<ComponentIndex> | undefined;

/**
 * Memoized per build process: every plugin instance that opts into
 * `experimental.liveIndex: true` triggers at most one indexing pass (or
 * cache read), no matter how many `optimizeImports`/`optimizeCss` instances
 * request it.
 *
 * Falls back to the bundled static `component-index.ts` on any failure
 * (unresolvable `carbon-components-svelte`, unexpected Carbon `src` layout,
 * etc.) so opting in can't turn a working build into a broken one.
 */
export function ensureLiveComponentIndex(): Promise<ComponentIndex> {
  if (!memoized) {
    memoized = resolveLiveComponentIndex().catch(async (error) => {
      console.warn(
        `${LOG_PREFIX} experimental.liveIndex: falling back to the bundled static component index (${(error as Error)?.message ?? error}).`,
      );
      const { components } = await import("../component-index");
      return components;
    });
  }
  return memoized;
}
