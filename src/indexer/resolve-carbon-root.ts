import { CarbonSvelte } from "../constants";
import { packageSignature, requirePackageDir } from "../specializer/package";

/** Directory of the installed `carbon-components-svelte`; see `resolvePackageDir`. */
export function resolveCarbonRoot(from: string = process.cwd()): string {
  return requirePackageDir(CarbonSvelte.Components, from);
}

/** `packageSignature` of the Carbon at `carbonRoot`. */
export function carbonSignature(carbonRoot: string): Promise<string> {
  return packageSignature(carbonRoot, "src");
}
