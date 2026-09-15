import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Rollup } from "vite";
import { CarbonSvelte } from "../src/constants";
import { optimizeCss } from "../src/plugins/optimize-css";

type OutputAsset = Rollup.OutputAsset;
type OutputBundle = Rollup.OutputBundle;

const carbonComponent = `node_modules/${CarbonSvelte.Components}/Button.svelte`;

function makeCssBundle(source: string): OutputBundle {
  return {
    "styles.css": {
      type: "asset",
      source,
    } as OutputAsset,
  } as unknown as OutputBundle;
}

describe("optimizeCss (Vite plugin)", () => {
  test("prunes unused Carbon classes when a component is imported", async () => {
    const plugin = optimizeCss({ silent: true });
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;

    // @ts-expect-error - hooks are plain functions on this plugin
    await plugin.buildStart();
    // @ts-expect-error
    plugin.transform("", carbonComponent);

    const bundle = makeCssBundle(cssContent);
    // @ts-expect-error
    await plugin.generateBundle({}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toEqual(
      ".bx--btn { color: blue }",
    );
  });

  test("does not leak imported component ids into the next build", async () => {
    // Regression test: a long-running `vite build --watch` session reuses the
    // same plugin instance across rebuilds. If tracked ids aren't reset, a
    // component removed from the app in a later rebuild still keeps its CSS
    // classes alive, silently degrading optimization over time.
    const plugin = optimizeCss({ silent: true });
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;

    // First build: Button is imported.
    // @ts-expect-error
    await plugin.buildStart();
    // @ts-expect-error
    plugin.transform("", carbonComponent);
    const firstBundle = makeCssBundle(cssContent);
    // @ts-expect-error
    await plugin.generateBundle({}, firstBundle);
    expect((firstBundle["styles.css"] as OutputAsset).source).toEqual(
      ".bx--btn { color: blue }",
    );

    // Second build (rebuild): Button is no longer imported, so `transform`
    // never fires for it this time around.
    // @ts-expect-error
    await plugin.buildStart();
    const secondBundle = makeCssBundle(cssContent);
    // @ts-expect-error
    await plugin.generateBundle({}, secondBundle);

    // No Carbon components are tracked anymore, so the plugin should skip
    // optimization entirely and leave the CSS untouched (per the "Skip
    // processing if no Carbon Svelte imports are found" early return).
    expect((secondBundle["styles.css"] as OutputAsset).source).toEqual(
      cssContent,
    );
  });

  test("keeps literal bx-- classes found in app modules", async () => {
    const plugin = optimizeCss({ silent: true });
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }
.bx--modal { background: red }`;

    // @ts-expect-error
    await plugin.buildStart();
    // @ts-expect-error
    plugin.transform("", carbonComponent);
    // @ts-expect-error
    plugin.transform('const c = "bx--accordion";', "/app/src/App.svelte");

    const bundle = makeCssBundle(cssContent);
    // @ts-expect-error
    await plugin.generateBundle({}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toEqual(
      `.bx--btn { color: blue }
.bx--accordion { background: yellow }`,
    );
  });

  test("scanModules: false ignores app modules", async () => {
    const plugin = optimizeCss({ silent: true, scanModules: false });
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;

    // @ts-expect-error
    await plugin.buildStart();
    // @ts-expect-error
    plugin.transform("", carbonComponent);
    // @ts-expect-error
    plugin.transform('const c = "bx--accordion";', "/app/src/App.svelte");

    const bundle = makeCssBundle(cssContent);
    // @ts-expect-error
    await plugin.generateBundle({}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toEqual(
      ".bx--btn { color: blue }",
    );
  });

  test("does not scan CSS modules or virtual modules", async () => {
    const plugin = optimizeCss({ silent: true });
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;

    // @ts-expect-error
    await plugin.buildStart();
    // @ts-expect-error
    plugin.transform("", carbonComponent);
    // @ts-expect-error
    plugin.transform(
      "bx--accordion",
      "/app/src/App.svelte?svelte&type=style&lang.css",
    );
    // @ts-expect-error
    plugin.transform("bx--accordion", "\0virtual:thing");

    const bundle = makeCssBundle(cssContent);
    // @ts-expect-error
    await plugin.generateBundle({}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toEqual(
      ".bx--btn { color: blue }",
    );
  });

  test("does not scan Carbon's own non-component sources", async () => {
    const plugin = optimizeCss({ silent: true });
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;

    // @ts-expect-error
    await plugin.buildStart();
    // @ts-expect-error
    plugin.transform("", carbonComponent);
    // @ts-expect-error
    plugin.transform(
      "bx--accordion",
      `/n/node_modules/${CarbonSvelte.Components}/src/utils/x.js`,
    );

    const bundle = makeCssBundle(cssContent);
    // @ts-expect-error
    await plugin.generateBundle({}, bundle);

    expect((bundle["styles.css"] as OutputAsset).source).toEqual(
      ".bx--btn { color: blue }",
    );
  });

  test("clears module classes between watch-mode rebuilds", async () => {
    const plugin = optimizeCss({ silent: true });
    const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }`;

    // First build: Button is imported and an app module has a literal token.
    // @ts-expect-error
    await plugin.buildStart();
    // @ts-expect-error
    plugin.transform("", carbonComponent);
    // @ts-expect-error
    plugin.transform('const c = "bx--accordion";', "/app/src/App.svelte");
    const firstBundle = makeCssBundle(cssContent);
    // @ts-expect-error
    await plugin.generateBundle({}, firstBundle);
    expect((firstBundle["styles.css"] as OutputAsset).source).toEqual(
      cssContent,
    );

    // Second build: Button is re-imported but the app module is gone. If
    // `moduleClasses` leaked across builds, `.bx--accordion` would survive.
    // @ts-expect-error
    await plugin.buildStart();
    // @ts-expect-error
    plugin.transform("", carbonComponent);
    const secondBundle = makeCssBundle(cssContent);
    // @ts-expect-error
    await plugin.generateBundle({}, secondBundle);

    expect((secondBundle["styles.css"] as OutputAsset).source).toEqual(
      ".bx--btn { color: blue }",
    );
  });

  test("content globs resolve from Vite's config.root", async () => {
    const dir = mkdtempSync(join(tmpdir(), "optimize-css-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(
        join(dir, "src", "App.svelte"),
        '<div class="bx--accordion"></div>',
      );

      const plugin = optimizeCss({
        silent: true,
        content: ["src/**/*.svelte"],
      });
      const cssContent = `.bx--btn { color: blue }
.bx--accordion { background: yellow }
.bx--modal { background: red }`;

      // @ts-expect-error
      await plugin.buildStart();
      // @ts-expect-error
      plugin.configResolved({ root: dir });
      // @ts-expect-error
      plugin.transform("", carbonComponent);

      const bundle = makeCssBundle(cssContent);
      // @ts-expect-error
      await plugin.generateBundle({}, bundle);

      expect((bundle["styles.css"] as OutputAsset).source).toEqual(
        `.bx--btn { color: blue }
.bx--accordion { background: yellow }`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
