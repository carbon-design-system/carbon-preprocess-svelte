import { requirePackageDir } from "svelte-prune/internal";
import { CarbonSvelte } from "../constants";

export function resolveCarbonRoot(from: string = process.cwd()): string {
  return requirePackageDir(CarbonSvelte.Components, from);
}
