import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  componentIndexCacheFile,
  isComponentIndex,
  loadComponentIndex,
  resolveComponentIndex,
} from "carbon-preprocess-svelte/indexer/load-index";
import { version as OWN_VERSION } from "../package.json";
import { components } from "./helpers/component-index";
import { createFakeProject } from "./helpers/fake-project";
import { resolvePackageRoot } from "./helpers/resolve-package-root";

const CARBON_VERSION: string = (
  await import(
    path.join(resolvePackageRoot("carbon-components-svelte"), "package.json")
  )
).version;

describe("isComponentIndex", () => {
  test("accepts the shape buildComponentIndex produces", () => {
    expect(isComponentIndex(components)).toBe(true);
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

describe("resolveComponentIndex", () => {
  let project: ReturnType<typeof createFakeProject>;
  let carbonRoot: string;
  let cacheFile: string;

  beforeEach(() => {
    project = createFakeProject();
    carbonRoot = project.linkCarbon();
    cacheFile = componentIndexCacheFile(carbonRoot, CARBON_VERSION);
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

  test("a Carbon zipped by Yarn PnP caches in the project's node_modules, not the archive", () => {
    const zipped =
      "/home/me/.yarn/berry/cache/carbon-components-svelte-npm-0.112.0.zip/node_modules/carbon-components-svelte";

    expect(componentIndexCacheFile(zipped, CARBON_VERSION, project.root)).toBe(
      path.join(
        project.root,
        "node_modules",
        ".cache",
        "carbon-preprocess-svelte",
        `${CARBON_VERSION}_${OWN_VERSION}.json`,
      ),
    );
  });

  test("cold: builds from the installed Carbon, matches a direct build, writes the cache", async () => {
    expect(existsSync(cacheFile)).toBe(false);

    const index = await resolveComponentIndex({
      projectRoot: project.root,
    });

    expect(index).toEqual(components);
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

    const index = await resolveComponentIndex({
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

    const index = await resolveComponentIndex({
      projectRoot: project.root,
    });

    expect(index).toEqual(components);
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

    const index = await resolveComponentIndex({
      projectRoot: project.root,
    });

    expect(index).toEqual(components);
  });
});

describe("loadComponentIndex", () => {
  test("returns undefined with a warning when indexing fails", async () => {
    const project = createFakeProject();
    project.installBrokenCarbon();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const index = await loadComponentIndex(project.root);

      expect(index).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("leaving Carbon CSS unpruned");
      expect(
        existsSync(path.join(project.root, "node_modules", ".cache")),
      ).toBe(false);
    } finally {
      warn.mockRestore();
      project.dispose();
    }
  });

  test("is memoized per project root", async () => {
    const project = createFakeProject();
    project.linkCarbon();

    try {
      const first = loadComponentIndex(project.root);

      expect(loadComponentIndex(`${project.root}/`)).toBe(first);
      expect(loadComponentIndex()).not.toBe(first);
      expect(await first).toEqual(components);
    } finally {
      project.dispose();
    }
  });
});
