import { requirePackageDir } from "svelte-prune/internal";
import { CarbonSvelte } from "../constants";

/**
 * Directory of the installed `carbon-components-svelte`;
 * see `resolvePackageDir`.
 */
export function resolveCarbonRoot(from: string = process.cwd()): string {
  return requirePackageDir(CarbonSvelte.Components, from);
}
