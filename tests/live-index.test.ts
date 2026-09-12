import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { components as staticComponents } from "carbon-preprocess-svelte/component-index";
import {
  ensureLiveComponentIndex,
  isComponentIndex,
  liveIndexCacheFile,
  loadLiveComponentIndex,
  resolveLiveComponentIndex,
} from "carbon-preprocess-svelte/indexer/live-index";
import { version as OWN_VERSION } from "../package.json";
import { createFakeProject } from "./helpers/fake-project";
import { resolvePackageRoot } from "./helpers/resolve-package-root";

const CARBON_VERSION: string = (
  await import(
    path.join(resolvePackageRoot("carbon-components-svelte"), "package.json")
  )
).version;

describe("isComponentIndex", () => {
  test("accepts the shape buildComponentIndex produces", () => {
    expect(isComponentIndex(staticComponents)).toBe(true);
    expect(
      isComponentIndex({ Button: { path: "a.svelte", classes: [".bx--btn"] } }),
    ).toBe(true);
  });

  test.each([
    ["null", null],
    ["array", []],
    ["empty object", {}],
    ["string", "{}"],
    ["entry missing path", { Button: { classes: [] } }],
    ["entry with non-string path", { Button: { path: 1, classes: [] } }],
    ["entry missing classes", { Button: { path: "a.svelte" } }],
    ["entry with non-string class", { Button: { path: "a", classes: [1] } }],
    ["null entry", { Button: null }],
  ])("rejects %s", (_, value) => {
    expect(isComponentIndex(value)).toBe(false);
  });
});

describe("resolveLiveComponentIndex", () => {
  let project: ReturnType<typeof createFakeProject>;
  let carbonRoot: string;
  let cacheFile: string;

  beforeEach(() => {
    project = createFakeProject();
    carbonRoot = project.linkCarbon();
    cacheFile = liveIndexCacheFile(carbonRoot, CARBON_VERSION);
  });

  afterEach(() => {
    project.dispose();
  });

  test("cache file lives in the project's node_modules, keyed by both versions", () => {
    expect(cacheFile).toBe(
      path.join(
        project.root,
        "node_modules",
        ".cache",
        "carbon-preprocess-svelte",
        `${CARBON_VERSION}_${OWN_VERSION}.json`,
      ),
    );
  });

  test("cold: builds from the installed Carbon, matches the frozen index, writes the cache", async () => {
    expect(existsSync(cacheFile)).toBe(false);

    const index = await resolveLiveComponentIndex({
      projectRoot: project.root,
    });

    expect(index).toEqual(staticComponents);
    expect(existsSync(cacheFile)).toBe(true);
    expect(JSON.parse(await Bun.file(cacheFile).text())).toEqual(index);
    // No leftover temp file from the atomic write.
    expect(readdirSync(path.dirname(cacheFile))).toEqual([
      path.basename(cacheFile),
    ]);
  });

  test("warm: a well-formed cache is served as-is without re-indexing", async () => {
    const tampered = { Button: { path: "cached.svelte", classes: [".bx--x"] } };
    mkdirSync(path.dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(tampered));

    const index = await resolveLiveComponentIndex({
      projectRoot: project.root,
    });

    expect(index).toEqual(tampered);
  });

  test.each([
    ["truncated JSON", '{"Button":{"path":"a.svelte","cla'],
    ["empty object", "{}"],
    ["array", "[]"],
    ["wrong entry shape", '{"Button":{"path":1}}'],
  ])("malformed cache (%s) is ignored and rebuilt", async (_, contents) => {
    mkdirSync(path.dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, contents);

    const index = await resolveLiveComponentIndex({
      projectRoot: project.root,
    });

    expect(index).toEqual(staticComponents);
    expect(JSON.parse(await Bun.file(cacheFile).text())).toEqual(index);
  });

  test("a cache written by another preprocessor version is not reused", async () => {
    const stale = path.join(
      path.dirname(cacheFile),
      `${CARBON_VERSION}_0.0.0.json`,
    );
    mkdirSync(path.dirname(cacheFile), { recursive: true });
    writeFileSync(
      stale,
      JSON.stringify({ Button: { path: "stale.svelte", classes: [] } }),
    );

    const index = await resolveLiveComponentIndex({
      projectRoot: project.root,
    });

    expect(index).toEqual(staticComponents);
  });
});

describe("loadLiveComponentIndex", () => {
  test("falls back to the frozen index with a warning when indexing fails", async () => {
    const project = createFakeProject();
    // A package.json but no `src/`: resolvable, un-indexable.
    const broken = path.join(
      project.root,
      "node_modules",
      "carbon-components-svelte",
    );
    mkdirSync(broken, { recursive: true });
    writeFileSync(
      path.join(broken, "package.json"),
      JSON.stringify({ name: "carbon-components-svelte", version: "9.9.9" }),
    );
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const index = await loadLiveComponentIndex({ projectRoot: project.root });

      expect(index).toBe(staticComponents);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(
        "falling back to the bundled static component index",
      );
      expect(
        existsSync(path.join(project.root, "node_modules", ".cache")),
      ).toBe(false);
    } finally {
      warn.mockRestore();
      project.dispose();
    }
  });
});

describe("ensureLiveComponentIndex", () => {
  test("is memoized per process", async () => {
    const first = ensureLiveComponentIndex();
    expect(ensureLiveComponentIndex()).toBe(first);
    expect(isComponentIndex(await first)).toBe(true);
  });
});
