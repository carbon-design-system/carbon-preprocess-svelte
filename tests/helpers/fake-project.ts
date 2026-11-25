import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
    /**
     * A `carbon-components-svelte` with a `package.json` but no `src/`:
     * resolvable, but indexing it fails.
     */
    installBrokenCarbon(): void {
      const carbon = path.join(
        root,
        "node_modules",
        "carbon-components-svelte",
      );
      mkdirSync(carbon, { recursive: true });
      writeFileSync(
        path.join(carbon, "package.json"),
        JSON.stringify({ name: "carbon-components-svelte", version: "9.9.9" }),
      );
    },
    /**
     * A `carbon-components-svelte` of `Button`, `Accordion` and `Tag`,
     * each rendering its one class, with a stylesheet defining them: an
     * analysis of every component costs a fraction of the real one's.
     */
    installTinyCarbon(): void {
      const carbon = path.join(
        root,
        "node_modules",
        "carbon-components-svelte",
      );
      const components = { Button: "btn", Accordion: "accordion", Tag: "tag" };
      mkdirSync(path.join(carbon, "css"), { recursive: true });
      writeFileSync(
        path.join(carbon, "package.json"),
        JSON.stringify({
          name: "carbon-components-svelte",
          version: "0.0.0",
          type: "module",
          svelte: "./src/index.js",
        }),
      );
      const exports: string[] = [];
      const rules: string[] = [];
      for (const [name, cls] of Object.entries(components)) {
        mkdirSync(path.join(carbon, "src", name), { recursive: true });
        writeFileSync(
          path.join(carbon, "src", name, `${name}.svelte`),
          `<div class="bx--${cls}"><slot /></div>\n`,
        );
        exports.push(
          `export { default as ${name} } from "./${name}/${name}.svelte";`,
        );
        rules.push(`.bx--${cls}{color:red}`);
      }
      writeFileSync(path.join(carbon, "src", "index.js"), exports.join("\n"));
      writeFileSync(path.join(carbon, "css", "white.css"), rules.join("\n"));
    },
    dispose() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
