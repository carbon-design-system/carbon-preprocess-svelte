import { createHash } from "node:crypto";
import type { Rollup } from "vite";
import { writePrunedCss } from "../src/plugins/rename-pruned-css";

const PATTERN = "assets/[name]-[hash][extname]";

/** The hash `writePrunedCss` gives `css`, at Rollup's default length. */
function hashOf(css: string): string {
  return createHash("sha256").update(css).digest("base64url").slice(0, 8);
}

function asset(fileName: string, source: string, ...names: string[]) {
  return {
    type: "asset",
    fileName,
    source,
    names,
    originalFileNames: [],
  } as unknown as Rollup.OutputAsset;
}

/** A bundle, and a context whose `emitFile` adds to it. */
function setup(files: Record<string, unknown>) {
  const bundle = files as Rollup.OutputBundle;
  const context = {
    emitFile(file: {
      fileName?: string;
      name?: string;
      source?: string | Uint8Array;
    }) {
      const fileName = file.fileName as string;
      bundle[fileName] = asset(
        fileName,
        String(file.source),
        ...(file.name ? [file.name] : []),
      );
      return fileName;
    },
  };
  return { bundle, context };
}

const OLD = "assets/index-OLDHASH0.css";

describe("writePrunedCss", () => {
  test("renames a hashed CSS asset and every reference to it", () => {
    const meta = {
      importedCss: new Set([OLD]),
      importedAssets: new Set<string>(),
    };
    const { bundle, context } = setup({
      [OLD]: asset(OLD, ".a{}.b{}", "index.css"),
      "assets/index-JS.js": {
        type: "chunk",
        fileName: "assets/index-JS.js",
        code: 'const css = "/assets/index-OLDHASH0.css";',
        viteMetadata: meta,
      },
      "index.html": asset(
        "index.html",
        '<link rel="stylesheet" href="/assets/index-OLDHASH0.css">',
      ),
    });

    writePrunedCss(context, bundle, new Map([[OLD, ".a{}"]]), PATTERN);

    const renamed = `assets/index-${hashOf(".a{}")}.css`;
    expect(bundle[OLD]).toBeUndefined();
    expect((bundle[renamed] as Rollup.OutputAsset).source).toBe(".a{}");
    expect((bundle[renamed] as Rollup.OutputAsset).names).toEqual([
      "index.css",
    ]);
    expect([...meta.importedCss]).toEqual([renamed]);
    expect((bundle["assets/index-JS.js"] as Rollup.OutputChunk).code).toBe(
      `const css = "/${renamed}";`,
    );
    expect((bundle["index.html"] as Rollup.OutputAsset).source).toBe(
      `<link rel="stylesheet" href="/${renamed}">`,
    );
  });

  test("names the CSS the same way every time", () => {
    const first = setup({ [OLD]: asset(OLD, ".a{}.b{}", "index.css") });
    const second = setup({ [OLD]: asset(OLD, ".a{}.c{}", "index.css") });
    writePrunedCss(
      first.context,
      first.bundle,
      new Map([[OLD, ".a{}"]]),
      PATTERN,
    );
    writePrunedCss(
      second.context,
      second.bundle,
      new Map([[OLD, ".a{}"]]),
      PATTERN,
    );
    expect(Object.keys(first.bundle)).toEqual(Object.keys(second.bundle));
  });

  test("keeps the name of an asset merged from several sources", () => {
    const merged = "_astro/index.Ab-12cD_.css";
    const { bundle, context } = setup({
      [merged]: asset(merged, ".a{}.b{}", "App.css", "index.css"),
    });
    writePrunedCss(
      context,
      bundle,
      new Map([[merged, ".a{}"]]),
      "_astro/[name].[hash][extname]",
    );
    expect(Object.keys(bundle)).toEqual([`_astro/index.${hashOf(".a{}")}.css`]);
  });

  test("follows `[hash:n]`", () => {
    const short = "assets/index-abcd.css";
    const { bundle, context } = setup({
      [short]: asset(short, ".a{}.b{}", "index.css"),
    });
    writePrunedCss(
      context,
      bundle,
      new Map([[short, ".a{}"]]),
      "assets/[name]-[hash:4][extname]",
    );
    expect(Object.keys(bundle)).toEqual([
      `assets/index-${hashOf(".a{}").slice(0, 4)}.css`,
    ]);
  });

  test("follows a function `assetFileNames`", () => {
    const { bundle, context } = setup({
      [OLD]: asset(OLD, ".a{}.b{}", "index.css"),
    });
    writePrunedCss(context, bundle, new Map([[OLD, ".a{}"]]), () => PATTERN);
    expect(bundle[OLD]).toBeUndefined();
  });

  test("keeps a name with no content hash in it", () => {
    const { bundle, context } = setup({
      "bundle.css": asset("bundle.css", ".a{}.b{}", "bundle.css"),
    });
    writePrunedCss(
      context,
      bundle,
      new Map([["bundle.css", ".a{}"]]),
      "[name][extname]",
    );
    expect(Object.keys(bundle)).toEqual(["bundle.css"]);
    expect((bundle["bundle.css"] as Rollup.OutputAsset).source).toBe(".a{}");
  });

  test("keeps the name a plugin gave with a fixed `fileName`", () => {
    const { bundle, context } = setup({
      "build/bundle.css": asset("build/bundle.css", ".a{}.b{}", "bundle.css"),
    });
    writePrunedCss(
      context,
      bundle,
      new Map([["build/bundle.css", ".a{}"]]),
      PATTERN,
    );
    expect(Object.keys(bundle)).toEqual(["build/bundle.css"]);
  });

  test("writes in place without `emitFile`", () => {
    const bundle = {
      [OLD]: asset(OLD, ".a{}.b{}", "index.css"),
    } as Rollup.OutputBundle;
    writePrunedCss({}, bundle, new Map([[OLD, ".a{}"]]), PATTERN);
    expect((bundle[OLD] as Rollup.OutputAsset).source).toBe(".a{}");
  });
});
