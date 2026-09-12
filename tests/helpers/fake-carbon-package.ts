import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Minimal on-disk `carbon-components-svelte` layout for exercising
 * `buildComponentIndex` against a shape that doesn't exist in any published
 * version yet (e.g. a future rename), without needing a real npm install.
 * Only `src/index.js`, `src/**\/*.{js,svelte}`, and `css/white.css` are read
 * by the indexer, so that's all this fixture provides.
 */
export function createFakeCarbonPackage(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "fake-carbon-"));

  mkdirSync(path.join(root, "css"), { recursive: true });
  writeFileSync(path.join(root, "css", "white.css"), "");

  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(root, "src", relativePath);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }

  return {
    root,
    dispose() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
