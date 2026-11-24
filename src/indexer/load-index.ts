import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { isLinkedCheckout } from "svelte-prune/internal";
import { version as OWN_VERSION } from "../../package.json";
import { CarbonSvelte, LOG_PREFIX } from "../constants";
import { errorMessage } from "../utils";
import type { ComponentIndex } from "./build-index";
import { carbonSignature, resolveCarbonRoot } from "./resolve-carbon-root";

const CACHE_DIRNAME = ".cache/carbon-preprocess-svelte";

const ZIP_ARCHIVE_REGEX = /\.zip[\\/]/;
/** A cache entry or an interrupted write's temp file: `<carbon>_<own>.json[.<pid>.<time>.tmp]`. */
const CACHE_ENTRY_REGEX = /^[^_]+_[^_]+\.json(?:\.\d+\.\d+\.tmp)?$/;
/**
 * Entries untouched this long are pruned when a new one is written. Not
 * every other entry: a monorepo can run two versions of this package
 * against one hoisted Carbon, and they'd evict each other's on every build.
 */
const STALE_MS = 24 * 60 * 60 * 1000;

async function readCarbonVersion(carbonRoot: string): Promise<string> {
  const pkg = JSON.parse(
    await readFile(path.join(carbonRoot, "package.json"), "utf8"),
  );
  return typeof pkg.version === "string" ? pkg.version : "unknown";
}

/**
 * Structural check on whatever came off disk: an empty or differently-shaped
 * index would become an empty allowlist and prune every Carbon rule.
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
 * Best-effort and atomic: a temp file is renamed into place so a concurrent
 * build never reads a half-written one. A failed write means the next build
 * re-indexes.
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
    return;
  }
  await pruneCache(cacheFile);
}

/**
 * Removes the cache entries other versions wrote more than `STALE_MS` ago,
 * so upgrades don't pile them up. Best-effort, like the write.
 */
async function pruneCache(cacheFile: string): Promise<void> {
  const dir = path.dirname(cacheFile);
  const now = Date.now();
  try {
    await Promise.all(
      (await readdir(dir))
        .filter(
          (name) =>
            name !== path.basename(cacheFile) && CACHE_ENTRY_REGEX.test(name),
        )
        .map(async (name) => {
          const file = path.join(dir, name);
          if (now - (await stat(file)).mtimeMs > STALE_MS)
            await rm(file, { force: true });
        }),
    );
  } catch {
    // Another build may be pruning too: whatever's left goes next time.
  }
}

/**
 * Cache file for one (Carbon version, this package's version) pair under
 * `node_modules/.cache/carbon-preprocess-svelte/`: a bump on either side
 * misses. A Carbon zipped by Yarn PnP uses the project's `node_modules`
 * instead, since writing there would write into the archive.
 */
export function componentIndexCacheFile(
  carbonRoot: string,
  carbonVersion: string,
  projectRoot: string = process.cwd(),
): string {
  return path.join(
    ZIP_ARCHIVE_REGEX.test(carbonRoot)
      ? path.join(path.resolve(projectRoot), "node_modules")
      : path.dirname(carbonRoot),
    CACHE_DIRNAME,
    `${carbonVersion}_${OWN_VERSION}.json`,
  );
}

/**
 * Builds (or reads the cached) component index for the
 * `carbon-components-svelte` installed in the project. Throws if it can't.
 */
export async function resolveComponentIndex(options?: {
  /** Directory the installed `carbon-components-svelte` is resolved from. */
  projectRoot?: string;
}): Promise<ComponentIndex> {
  const carbonRoot = resolveCarbonRoot(options?.projectRoot);
  const cacheFile = isLinkedCheckout(carbonRoot)
    ? undefined
    : componentIndexCacheFile(
        carbonRoot,
        await readCarbonVersion(carbonRoot),
        options?.projectRoot,
      );

  const cached = cacheFile && (await readCache(cacheFile));
  if (cached) return cached;

  // Only on a cache miss: a build reading the cache never needs the parser.
  const { buildComponentIndex } = await import("./build-index");
  const index = await buildComponentIndex({ carbonRoot });

  if (!isComponentIndex(index)) {
    throw new Error(
      `Indexed "${carbonRoot}" but found no exported components; unexpected package layout.`,
    );
  }

  if (cacheFile) await writeCache(cacheFile, index);
  return index;
}

const memoized = new Map<string, Promise<ComponentIndex | undefined>>();

/**
 * The component index every CSS entry point prunes against, or `undefined`
 * with a warning when it can't be built (unresolvable Carbon, unexpected
 * `src` layout). Callers then leave CSS unpruned: a bigger stylesheet is
 * safe, while pruning against another Carbon version's index drops rules the
 * installed markup still uses (#213).
 *
 * Memoized per project root and `carbonSignature`, so a build indexes at
 * most once and a failure warns once, until Carbon changes: a watch session
 * can outlive an install, an upgrade or an edit to a linked checkout.
 */
export async function loadComponentIndex(
  projectRoot: string = process.cwd(),
): Promise<ComponentIndex | undefined> {
  const root = path.resolve(projectRoot);
  let carbon = "";
  try {
    carbon = await carbonSignature(resolveCarbonRoot(root));
  } catch {
    // Unresolvable: indexing fails, and warns.
  }
  const key = `${root}\0${carbon}`;
  let pending = memoized.get(key);

  if (!pending) {
    pending = resolveComponentIndex({ projectRoot: root }).catch((error) => {
      console.warn(
        `${LOG_PREFIX} could not index the installed ${CarbonSvelte.Components} (${errorMessage(error)}); leaving Carbon CSS unpruned.`,
      );
      return undefined;
    });
    memoized.set(key, pending);
  }

  return pending;
}
