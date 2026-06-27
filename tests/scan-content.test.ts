import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanContentClasses } from "carbon-preprocess-svelte/plugins/scan-content";

describe("scanContentClasses", () => {
  test("returns an empty array when no content is provided", () => {
    expect(scanContentClasses()).toEqual([]);
    expect(scanContentClasses([])).toEqual([]);
  });

  test("extracts literal bx-- tokens from matched files", () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-content-"));
    try {
      writeFileSync(
        join(dir, "App.svelte"),
        `<div class="bx--grid">\n  <button class={\`bx--btn--\${kind}\`} />\n</div>`,
      );
      writeFileSync(join(dir, "ignore.txt"), "no carbon here");

      const classes = scanContentClasses([join(dir, "*.svelte")]).sort();
      expect(classes).toEqual([".bx--btn--", ".bx--grid"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns an empty array when globs match nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-content-"));
    try {
      expect(scanContentClasses([join(dir, "*.svelte")])).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
