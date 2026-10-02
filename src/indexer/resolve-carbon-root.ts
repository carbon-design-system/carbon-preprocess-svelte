import { existsSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { CarbonSvelte } from "../constants";

const nodeRequire = createRequire(import.meta.url);

type PnpApi = {
  resolveToUnqualified(request: string, issuer: string): string | null;
};

/** Carbon's directory according to Yarn Plug'n'Play, or `undefined` outside PnP. */
function resolveWithPnp(from: string): string | undefined {
  const { findPnpApi } = Module as {
    findPnpApi?: (lookupSource: string) => PnpApi | null;
  };
  if (typeof findPnpApi !== "function") return undefined;

  // A trailing separator makes the issuer the directory itself.
  const issuer = `${path.resolve(from)}${path.sep}`;
  try {
    const dir = findPnpApi(issuer)?.resolveToUnqualified(
      CarbonSvelte.Components,
      issuer,
    );
    return dir ? path.resolve(dir) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Directory of the installed `carbon-components-svelte`, searched from the
 * consuming project (`from`) first, then from this package's own location:
 * in a monorepo this package may be hoisted to the root while Carbon is
 * installed only under the app.
 *
 * Walks `require.resolve.paths` instead of resolving
 * `carbon-components-svelte/package.json`, which Carbon's `exports` map
 * blocks (`ERR_PACKAGE_PATH_NOT_EXPORTED`).
 */
export function resolveCarbonRoot(from: string = process.cwd()): string {
  const pnp = resolveWithPnp(from);
  if (pnp) return pnp;

  // `createRequire` wants a module filename; it need not exist on disk.
  const projectRequire = createRequire(path.join(from, "__resolve__.js"));
  const searchPaths = new Set([
    ...(projectRequire.resolve.paths(CarbonSvelte.Components) ?? []),
    ...(nodeRequire.resolve.paths(CarbonSvelte.Components) ?? []),
  ]);

  for (const base of searchPaths) {
    const candidate = path.join(base, CarbonSvelte.Components);
    if (existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }

  throw new Error(
    `Could not resolve an installed "${CarbonSvelte.Components}" package.`,
  );
}
