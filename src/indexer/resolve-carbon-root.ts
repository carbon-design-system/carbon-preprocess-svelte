import { packageSignature, requirePackageDir } from "severan/internal";
import { CarbonSvelte } from "../constants";

/** Directory of the installed `carbon-components-svelte`; see `resolvePackageDir`. */
export function resolveCarbonRoot(from: string = process.cwd()): string {
  return requirePackageDir(CarbonSvelte.Components, from);
}

/** `packageSignature` of the Carbon at `carbonRoot`. */
export function carbonSignature(carbonRoot: string): Promise<string> {
  return packageSignature(carbonRoot, "src");
}
