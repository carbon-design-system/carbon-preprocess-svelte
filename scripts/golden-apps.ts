/**
 * The golden apps in `golden/`: realistic Carbon apps of several files
 * (stores, fetched data, constants modules, i18n helpers, their own
 * wrappers), in legacy and runes syntax. The evals check that rewriting
 * them changes nothing, and `golden-report.ts` lists what still keeps
 * every variant. They're compiled with this repo's Svelte (5).
 */
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { collectCarbonImports } from "../src/plugins/scan-imports";

export type GoldenApp = {
  id: string;
  /** `src/App.svelte`, the component the app mounts. */
  entry: string;
  /** Every file in `src`, as `content` would hold them. */
  files: Array<{ file: string; code: string }>;
  /** Carbon components any of them imports. */
  components: string[];
};

export function goldenApps(root: string, only?: string): GoldenApp[] {
  const golden = path.join(root, "golden");
  return globSync("*/src/App.svelte", { cwd: golden })
    .map((entry) => path.join(golden, entry))
    .filter((entry) => !only || entry.includes(`${path.sep}${only}${path.sep}`))
    .sort()
    .map((entry) => {
      const src = path.dirname(entry);
      const files = globSync("**/*.{svelte,ts,js}", { cwd: src })
        .sort()
        .map((name) => {
          const file = path.join(src, name);
          return { file, code: readFileSync(file, "utf8") };
        });
      const imported = new Set<string>();
      for (const { code } of files) collectCarbonImports(code, imported);
      return {
        id: `golden/${path.basename(path.dirname(src))}`,
        entry,
        files,
        components: [...imported],
      };
    });
}
