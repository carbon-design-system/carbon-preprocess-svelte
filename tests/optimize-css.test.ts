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
});
