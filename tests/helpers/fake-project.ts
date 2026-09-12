import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolvePackageRoot } from "./resolve-package-root";

/**
 * Throwaway consumer project rooted in a temp dir. `linkCarbon(dir)` drops a
 * `node_modules/carbon-components-svelte` symlink (to the real devDependency
 * by default) under `dir`, so resolution and on-disk caching can be
 * exercised against a layout this repo's own `node_modules` doesn't have.
 */
export function createFakeProject() {
  const root = mkdtempSync(path.join(tmpdir(), "cps-project-"));

  return {
    root,
    linkCarbon(
      dir: string = root,
      target: string = resolvePackageRoot("carbon-components-svelte"),
    ): string {
      const nodeModules = path.join(dir, "node_modules");
      mkdirSync(nodeModules, { recursive: true });
      const link = path.join(nodeModules, "carbon-components-svelte");
      symlinkSync(target, link, "dir");
      return link;
    },
    dispose() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
