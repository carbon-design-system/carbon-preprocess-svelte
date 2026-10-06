import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { optimizeCarbonCss } from "carbon-preprocess-svelte";
import type { Rollup } from "vite";
import { resolveCarbonRoot } from "../src/indexer/resolve-carbon-root";
import { optimizeCss } from "../src/plugins/optimize-css";

const carbonRoot = resolveCarbonRoot();
const BUTTON = "Button/Button.svelte";
const IMPORT_BUTTON = `import { Button } from "carbon-components-svelte";`;

function app(script: string, markup: string): string {
  return `<script>\n${script}\n</script>\n\n${markup}\n`;
}

describe("propAware", () => {
  const BUTTON_CSS =
    ".bx--btn{a:1}.bx--btn--tertiary{a:2}.bx--btn--danger{a:3}.bx--btn--sm{a:4}.bx--accordion{a:5}";

  test("optimizeCarbonCss prunes variants the `content` files never use", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prop-aware-"));
    try {
      writeFileSync(
        join(dir, "App.svelte"),
        app(IMPORT_BUTTON, `<Button kind="tertiary">Hi</Button>`),
      );
      const options = {
        components: ["Button"],
        content: [join(dir, "*.svelte")],
      };

      const without = await optimizeCarbonCss(BUTTON_CSS, options);
      expect(without.css).toContain(".bx--btn--danger");

      const result = await optimizeCarbonCss(BUTTON_CSS, {
        ...options,
        propAware: true,
      });
      expect(result.css).toBe(".bx--btn{a:1}.bx--btn--tertiary{a:2}");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the Vite plugin reads call sites from each `.svelte` module's source", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prop-aware-"));
    const appFile = join(dir, "App.svelte");
    const buttonFile = join(carbonRoot, "src", BUTTON);
    try {
      writeFileSync(
        appFile,
        app(IMPORT_BUTTON, `<Button kind="tertiary">Hi</Button>`),
      );
      const plugin = optimizeCss({
        silent: true,
        propAware: true,
      }) as unknown as {
        buildStart(this: { warn: (message: string) => void }): Promise<void>;
        transform(code: string, id: string): void;
        generateBundle(
          this: { warn: (message: string) => void },
          options: unknown,
          bundle: Rollup.OutputBundle,
        ): Promise<void>;
      };
      const ctx = { warn: jest.fn() };
      await plugin.buildStart.call(ctx);
      // The plugin sees compiled JS; the source is read from disk.
      plugin.transform(
        `import { Button } from "carbon-components-svelte";`,
        appFile,
      );
      plugin.transform("", buttonFile);
      const bundle = {
        "styles.css": { type: "asset", source: BUTTON_CSS },
      } as unknown as Rollup.OutputBundle;
      await plugin.generateBundle.call(ctx, {}, bundle);

      expect((bundle["styles.css"] as Rollup.OutputAsset).source).toBe(
        ".bx--btn{a:1}.bx--btn--tertiary{a:2}",
      );
      expect(ctx.warn).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
