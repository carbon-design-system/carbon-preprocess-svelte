import { CarbonSvelte } from "../constants";
import {
  installedMajor,
  isLinkedCheckout,
  packageSignature,
  resolvePackageDir,
} from "../specializer/package";

export { installedMajor, isLinkedCheckout, resolvePackageDir };

/** Directory of the installed `carbon-components-svelte`; see `resolvePackageDir`. */
export function resolveCarbonRoot(from: string = process.cwd()): string {
  const root = resolvePackageDir(CarbonSvelte.Components, from);
  if (root) return root;
  throw new Error(
    `Could not resolve an installed "${CarbonSvelte.Components}" package.`,
  );
}

/** `packageSignature` of the Carbon at `carbonRoot`. */
export function carbonSignature(carbonRoot: string): Promise<string> {
  return packageSignature(carbonRoot, "src");
}
