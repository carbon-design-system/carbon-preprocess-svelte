import { existsSync, readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { CarbonSvelte } from "../constants";

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

/** Directory of the installed `carbon-components-svelte`; see `resolvePackageDir`. */
export function resolveCarbonRoot(from: string = process.cwd()): string {
  const root = resolvePackageDir(CarbonSvelte.Components, from);
  if (root) return root;
  throw new Error(
    `Could not resolve an installed "${CarbonSvelte.Components}" package.`,
  );
}
