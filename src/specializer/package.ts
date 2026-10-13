import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { listJsAndSvelteFiles } from "./list-files";

const nodeRequire = createRequire(import.meta.url);

type PnpApi = {
  resolveToUnqualified(request: string, issuer: string): string | null;
};

/** A package's directory according to Yarn Plug'n'Play, or `undefined` outside PnP. */
function resolveWithPnp(name: string, from: string): string | undefined {
  const { findPnpApi } = Module as {
    findPnpApi?: (lookupSource: string) => PnpApi | null;
  };
  if (typeof findPnpApi !== "function") return undefined;

  // A trailing separator makes the issuer the directory itself.
  const issuer = `${path.resolve(from)}${path.sep}`;
  try {
    const dir = findPnpApi(issuer)?.resolveToUnqualified(name, issuer);
    return dir ? path.resolve(dir) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Directory of the installed package `name`, searched from the consuming
 * project (`from`) first, then from this package's own location: in a
 * monorepo this package may be hoisted to the root while the package is
 * installed only under the app.
 *
 * Walks `require.resolve.paths` instead of resolving `<name>/package.json`,
 * which an `exports` map may block (`ERR_PACKAGE_PATH_NOT_EXPORTED`).
 */
export function resolvePackageDir(
  name: string,
  from: string = process.cwd(),
): string | undefined {
  const pnp = resolveWithPnp(name, from);
  if (pnp) return pnp;

  // `createRequire` wants a module filename; it need not exist on disk.
  const projectRequire = createRequire(path.join(from, "__resolve__.js"));
  const searchPaths = new Set([
    ...(projectRequire.resolve.paths(name) ?? []),
    ...(nodeRequire.resolve.paths(name) ?? []),
  ]);

  for (const base of searchPaths) {
    const candidate = path.join(base, name);
    if (existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }
  return undefined;
}

/** Major version of the installed package `name`, if it resolves. */
export function installedMajor(
  name: string,
  from: string = process.cwd(),
): number | undefined {
  const dir = resolvePackageDir(name, from);
  if (!dir) return undefined;
  try {
    const { version } = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    ) as { version?: unknown };
    const major = Number.parseInt(String(version), 10);
    return Number.isNaN(major) ? undefined : major;
  } catch {
    return undefined;
  }
}

/** A checkout linked in (`bun link`, `workspace:`) rather than installed: its source changes under a fixed version, so a cache would go stale. */
export function isLinkedCheckout(root: string): boolean {
  try {
    return !realpathSync(root).split(path.sep).includes("node_modules");
  } catch {
    return false;
  }
}

/**
 * Changes when the package at `root` does: its real path and version, and
 * for a linked checkout, the modification times of the modules in its
 * `srcDir`. Caches of what a package contains key on it.
 */
export async function packageSignature(
  root: string,
  srcDir: string,
): Promise<string> {
  let version: unknown;
  try {
    ({ version } = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    ) as { version?: unknown });
  } catch {
    // Unversioned: only its sources tell it apart.
  }
  let real: string;
  try {
    real = realpathSync(root);
  } catch {
    return "";
  }
  let signature = `${real}@${String(version)}`;
  const linked = !real.split(path.sep).includes("node_modules");
  if (version !== undefined && !linked) return signature;
  const src = path.join(root, srcDir);
  try {
    for (const file of await listJsAndSvelteFiles(src)) {
      signature += `:${statSync(path.join(src, file)).mtimeMs}`;
    }
  } catch {
    // No `src`: indexing it fails, and says so.
  }
  return signature;
}
