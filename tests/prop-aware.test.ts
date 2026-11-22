import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { optimizeCarbonCss } from "carbon-preprocess-svelte";
import type { Rollup } from "vite";
import { resolveCarbonRoot } from "../src/indexer/resolve-carbon-root";
import { optimizeComponents } from "../src/plugins/optimize-components";
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

      const without = await optimizeCarbonCss(BUTTON_CSS, {
        ...options,
        propAware: false,
      });
      expect(without.css).toContain(".bx--btn--danger");

      // On by default, with `content` to read.
      const result = await optimizeCarbonCss(BUTTON_CSS, options);
      expect(result.css).toBe(".bx--btn{a:1}.bx--btn--tertiary{a:2}");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("optimizeCarbonCss keeps the tokens its `sources` name, and every one without them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prop-aware-"));
    try {
      writeFileSync(
        join(dir, "App.svelte"),
        app(IMPORT_BUTTON, `<Button kind="tertiary">Hi</Button>`),
      );
      const css = `:root{--cds-ai-border-start:1;--cds-ai-aura-start:2;--cds-ai-aura-hover-start:3}${BUTTON_CSS}.bx--btn{color:var(--cds-ai-border-start)}`;
      const options = {
        components: ["Button"],
        content: [join(dir, "*.svelte")],
      };

      // Nothing says what the build reads: every token stays.
      const without = await optimizeCarbonCss(css, options);
      expect(without.css).toContain("--cds-ai-aura-hover-start");

      const named = await optimizeCarbonCss(css, {
        ...options,
        sources: ['<p style="color: var(--cds-ai-aura-start)">'],
      });
      expect(named.css).toContain("--cds-ai-border-start:1");
      expect(named.css).toContain("--cds-ai-aura-start:2");
      expect(named.css).not.toContain("--cds-ai-aura-hover-start");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the Vite plugin keeps a component imported in a way it can't read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prop-aware-"));
    const appFile = join(dir, "App.svelte");
    const buttonFile = join(carbonRoot, "src", BUTTON);
    try {
      // `@carbon` is a bundler alias for `carbon-components-svelte`.
      const code = app(
        `import { Button } from "@carbon";`,
        `<Button kind="tertiary">Hi</Button>`,
      );
      writeFileSync(appFile, code);
      const plugin = optimizeCss({
        silent: true,
        propAware: true,
      }) as unknown as {
        buildStart(this: object): Promise<void>;
        transform(code: string, id: string): void;
        buildEnd(this: object): Promise<void>;
        generateBundle(
          this: object,
          options: unknown,
          bundle: Rollup.OutputBundle,
        ): Promise<void>;
      };
      const ctx = {
        warn: jest.fn(),
        getModuleIds: () => [appFile, buttonFile][Symbol.iterator](),
        getModuleInfo: (id: string) => ({
          importers: id === buttonFile ? [appFile] : [],
          dynamicImporters: [],
        }),
        resolve: async () => null,
      };
      await plugin.buildStart.call(ctx);
      plugin.transform(code, appFile);
      plugin.transform("", buttonFile);
      await plugin.buildEnd.call(ctx);
      const bundle = {
        "styles.css": { type: "asset", source: BUTTON_CSS },
      } as unknown as Rollup.OutputBundle;
      await plugin.generateBundle.call(ctx, {}, bundle);

      // Every variant stays, as without `propAware`.
      expect((bundle["styles.css"] as Rollup.OutputAsset).source).toBe(
        ".bx--btn{a:1}.bx--btn--tertiary{a:2}.bx--btn--danger{a:3}.bx--btn--sm{a:4}",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the Vite plugin keeps the tokens the module graph's markup and modules read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prop-aware-"));
    const appFile = join(dir, "App.svelte");
    const htmlFile = join(dir, "index.html");
    const buttonFile = join(carbonRoot, "src", BUTTON);
    try {
      const source = app(IMPORT_BUTTON, `<Button kind="tertiary">Hi</Button>`);
      writeFileSync(appFile, source);
      writeFileSync(
        htmlFile,
        '<p style="color: var(--cds-ai-aura-start)"></p>',
      );
      const plugin = optimizeCss({ silent: true }) as unknown as {
        buildStart(this: object): Promise<void>;
        transform(code: string, id: string): void;
        generateBundle(
          this: object,
          options: unknown,
          bundle: Rollup.OutputBundle,
        ): Promise<void>;
      };
      const modules: Record<string, string> = {
        [appFile]: `${source}\nconst style = "--cds-ai-aura-end";`,
        [buttonFile]: "",
        [htmlFile]: "",
      };
      const ctx = {
        warn: jest.fn(),
        getModuleIds: () => Object.keys(modules)[Symbol.iterator](),
        getModuleInfo: (id: string) => ({
          code: modules[id],
          importers: [],
          dynamicImporters: [],
        }),
      };
      await plugin.buildStart.call(ctx);
      plugin.transform(modules[appFile], appFile);
      plugin.transform("", buttonFile);
      const css = `:root{--cds-ai-aura-start:1;--cds-ai-aura-end:2;--cds-ai-aura-hover-start:3}${BUTTON_CSS}`;
      const bundle = {
        "styles.css": { type: "asset", source: css },
      } as unknown as Rollup.OutputBundle;
      await plugin.generateBundle.call(ctx, {}, bundle);

      const pruned = String(
        (bundle["styles.css"] as Rollup.OutputAsset).source,
      );
      expect(pruned).toContain("--cds-ai-aura-start:1");
      expect(pruned).toContain("--cds-ai-aura-end:2");
      expect(pruned).not.toContain("--cds-ai-aura-hover-start");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.each([
    ["by default", {}, ".bx--btn{a:1}.bx--btn--tertiary{a:2}"],
    [
      "not with `propAware: false`",
      { propAware: false },
      ".bx--btn{a:1}.bx--btn--tertiary{a:2}.bx--btn--danger{a:3}.bx--btn--sm{a:4}",
    ],
  ] as const)(
    "the Vite plugin reads call sites from each `.svelte` module's source %s",
    async (_, options, expected) => {
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
          ...options,
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
          expected,
        );
        expect(ctx.warn).not.toHaveBeenCalled();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  test("optimizeCarbonCss without `content` warns only when asked for propAware", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const quiet = await optimizeCarbonCss(BUTTON_CSS, {
        components: ["Button"],
      });
      expect(quiet.css).toContain(".bx--btn--danger");
      expect(warn).not.toHaveBeenCalled();

      await optimizeCarbonCss(BUTTON_CSS, {
        components: ["Button"],
        propAware: true,
      });
      expect(warn.mock.calls[0]?.[0]).toContain("propAware needs `content`");
    } finally {
      warn.mockRestore();
    }
  });

  test.each([
    [
      "with `optimizeComponents` in the build",
      true,
      ".bx--btn{a:1}.bx--btn--tertiary{a:2}",
    ],
    // Its own collector saw no call site of Button: nothing of it renders.
    ["alone, without the app's module", false, ""],
  ] as const)(
    "the Vite plugin prunes from `optimizeComponents`' analysis %s",
    async (_, both, expected) => {
      const dir = mkdtempSync(join(tmpdir(), "prop-aware-"));
      const appFile = join(dir, "App.svelte");
      const buttonFile = join(carbonRoot, "src", BUTTON);
      try {
        writeFileSync(
          appFile,
          app(IMPORT_BUTTON, `<Button kind="tertiary">Hi</Button>`),
        );
        type Hooks = {
          configResolved(config: object): void;
          buildStart(this: object, options?: object): Promise<void>;
          transform(code: string, id: string): void;
          generateBundle(
            this: object,
            options: unknown,
            bundle: Rollup.OutputBundle,
          ): Promise<void>;
        };
        const config = {
          root: dir,
          command: "build",
          logger: { info: () => {} },
        };
        const ctx = {
          warn: jest.fn(),
          info: jest.fn(),
          resolve: async () => null,
        };
        if (both) {
          const components = optimizeComponents({
            silent: true,
            content: ["App.svelte"],
          }) as unknown as Hooks;
          components.configResolved(config);
          await components.buildStart.call(ctx);
        }
        const css = optimizeCss({ silent: true }) as unknown as Hooks;
        css.configResolved(config);
        await css.buildStart.call(ctx, { plugins: [] });
        // Only Carbon's module: the call sites come from the shared analysis.
        css.transform("", buttonFile);
        const bundle = {
          "styles.css": { type: "asset", source: BUTTON_CSS },
        } as unknown as Rollup.OutputBundle;
        await css.generateBundle.call(ctx, {}, bundle);
        expect(ctx.warn).not.toHaveBeenCalled();
        expect((bundle["styles.css"] as Rollup.OutputAsset).source).toBe(
          expected,
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
