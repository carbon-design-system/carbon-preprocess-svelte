import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Minimal on-disk `carbon-components-svelte` layout for `buildComponentIndex`, without a real npm install. */
export function createMockCarbonPackage(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "mock-carbon-"));

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
