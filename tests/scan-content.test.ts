import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectCarbonTokens,
  scanContent,
  scanContentClasses,
} from "carbon-preprocess-svelte/plugins/scan-content";

describe("collectCarbonTokens", () => {
  test("adds nothing when the source has no bx-- token", () => {
    const classes = new Set<string>();
    collectCarbonTokens("const x = 1;", classes);
    expect(classes.size).toBe(0);
  });

  test("adds every literal bx-- token as a class selector", () => {
    const classes = new Set<string>();
    collectCarbonTokens('class="bx--grid bx--row"', classes);
    expect([...classes].sort()).toEqual([".bx--grid", ".bx--row"]);
  });

  test("keeps the trailing hyphen for a template literal prefix", () => {
    const classes = new Set<string>();
    collectCarbonTokens("`bx--btn--" + "$" + "{kind}`", classes);
    expect([...classes]).toEqual([".bx--btn--"]);
  });

  test("does not duplicate tokens across calls into the same set", () => {
    const classes = new Set<string>();
    collectCarbonTokens('class="bx--grid"', classes);
    collectCarbonTokens('class="bx--grid"', classes);
    expect([...classes]).toEqual([".bx--grid"]);
  });
});

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

  test("resolves relative globs from `cwd`", () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-content-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(
        join(dir, "src", "App.svelte"),
        '<div class="bx--grid"></div>',
      );

      expect(scanContentClasses(["src/*.svelte"], dir)).toEqual([".bx--grid"]);
      // Proves the old cwd-less behavior would have missed it.
      expect(scanContentClasses(["src/*.svelte"])).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("absolute globs ignore `cwd`", () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-content-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(
        join(dir, "src", "App.svelte"),
        '<div class="bx--grid"></div>',
      );

      expect(
        scanContentClasses([join(dir, "src/*.svelte")], "/nonexistent"),
      ).toEqual([".bx--grid"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scanContent", () => {
  test("reports matchedFiles on a hit", () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-content-"));
    try {
      writeFileSync(join(dir, "App.svelte"), '<div class="bx--grid"></div>');
      writeFileSync(join(dir, "Other.svelte"), '<div class="bx--row"></div>');

      const scan = scanContent([join(dir, "*.svelte")]);
      expect(scan.matchedFiles).toBe(2);
      expect(scan.classes.sort()).toEqual([".bx--grid", ".bx--row"]);
      expect(scan.error).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports matchedFiles: 0 on a miss", () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-content-"));
    try {
      const scan = scanContent([join(dir, "*.svelte")]);
      expect(scan.matchedFiles).toBe(0);
      expect(scan.classes).toEqual([]);
      expect(scan.error).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("populates error when a glob pattern is invalid", () => {
    // `globSync` requires every pattern to be a string and throws a
    // TypeError otherwise; there's no string glob syntax that Bun's
    // globSync rejects, so this exercises the error branch via a
    // type-violating element instead.
    const invalidContent = [null] as unknown as string[];

    const scan = scanContent(invalidContent);
    expect(scan.classes).toEqual([]);
    expect(scan.matchedFiles).toBe(0);
    expect(scan.error).toBeDefined();
  });
});
