// @reads golden/**
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type CarbonBunOptions,
  createCarbonOptimizer,
  optimizeCarbonBun,
  optimizeComponents,
  optimizeCss,
} from "carbon-preprocess-svelte";
import { build, defaultClientConditions, type Plugin, type Rollup } from "vite";
import { goldenSvelte } from "../scripts/golden-build";
import { GOLDEN_SCENARIOS } from "../scripts/golden-steps";
import { bunSvelte } from "./helpers/bun-svelte";

const ROOT = path.join(import.meta.dir, "..");
const VITE_HASH_MARKER = /\/\*\$vite\$:\d+\*\//;
const OUTSIDE_CONTENT = /Add those files to `content`/;
const NEEDS_METAFILE = /metafile: true/;
const NO_FILE = /virtual:page.*no file on disk/;
const CSS_LINK = /href="\.\/([\w-]+\.css)"/;
const SHEET_MARKER = "carbon-preprocess-svelte-sheet";
const WHITE_CSS = readFileSync(
  path.join(ROOT, "node_modules/carbon-components-svelte/css/white.css"),
  "utf8",
);

const VARIANTS = {
  css: { components: false, propAware: false },
  "prop-aware": { components: false, propAware: true },
  full: { components: true, propAware: true },
} as const;

type Variant = keyof typeof VARIANTS;

let out: string;
beforeAll(() => {
  // Real: Bun resolves an HTML entry's scripts relative to it.
  out = mkdtempSync(path.join(realpathSync(tmpdir()), "cps-bun-"));
});
afterAll(() => rmSync(out, { recursive: true, force: true }));

/**
 * Builds `app` with Vite and the plugins `variant` names, unminified:
 * the CSS `optimizeCss` was handed, and what it left.
 */
async function viteCss(app: string, variant: Variant) {
  const { components, propAware } = VARIANTS[variant];
  let input = "";
  let output = "";
  const cssOf = (bundle: Rollup.OutputBundle) => {
    const asset = Object.values(bundle).find(
      (file): file is Rollup.OutputAsset =>
        file.type === "asset" && file.fileName.endsWith(".css"),
    );
    return String(asset?.source ?? "");
  };
  // Around `optimizeCss`, which prunes in its own `generateBundle`.
  const before: Plugin = {
    name: "before",
    enforce: "post",
    generateBundle: {
      order: "pre",
      handler(_, bundle) {
        input = cssOf(bundle).replace(VITE_HASH_MARKER, "");
      },
    },
  };
  const after: Plugin = {
    name: "after",
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(_, bundle) {
        output = cssOf(bundle);
      },
    },
  };
  await build({
    root: path.join(ROOT, "golden", app),
    configFile: false,
    logLevel: "silent",
    mode: "production",
    resolve: {
      conditions: ["svelte", ...defaultClientConditions],
      dedupe: ["svelte"],
    },
    plugins: [
      ...(components ? [optimizeComponents({ silent: true })] : []),
      goldenSvelte(),
      before,
      optimizeCss({ silent: true, propAware }),
      after,
    ],
    build: {
      outDir: path.join(out, app, variant, "vite"),
      emptyOutDir: true,
      cssMinify: false,
      write: false,
    },
  });
  return { input, output };
}

/** Builds `app` with `Bun.build` and `optimizeCarbonBun`. */
async function bunBuild(
  app: string,
  options: CarbonBunOptions,
  outdir: string,
  entry = path.join(ROOT, "golden", app, "src/main.ts"),
) {
  const carbon = optimizeCarbonBun({
    root: path.join(ROOT, "golden", app),
    ...options,
  });
  const result = await Bun.build({
    entrypoints: [entry],
    outdir,
    target: "browser",
    conditions: ["svelte"],
    metafile: true,
    minify: true,
    plugins: [carbon, bunSvelte(carbon)],
  });
  if (!result.success) throw new AggregateError(result.logs);
  return { carbon, result };
}

describe("optimizeCarbonBun", () => {
  // The same CSS in, the same CSS out: pruned from the same analysis,
  // the same Carbon components, the same tokens as a Vite build.
  test.each(Object.keys(GOLDEN_SCENARIOS))(
    "prunes %s's CSS as the Vite plugins do",
    async (app) => {
      for (const variant of Object.keys(VARIANTS) as Variant[]) {
        const { components, propAware } = VARIANTS[variant];
        const vite = await viteCss(app, variant);
        const { carbon, result } = await bunBuild(
          app,
          {
            optimizeComponents: components && { silent: true },
            optimizeCss: { silent: true, propAware },
          },
          path.join(out, app, variant, "bun"),
        );
        const { "style.css": pruned } = await carbon.pruneCss(
          { "style.css": vite.input },
          result,
        );
        expect({ variant, size: pruned.length }).toEqual({
          variant,
          size: vite.output.length,
        });
        expect(pruned).toBe(vite.output);
        expect(pruned.length).toBeLessThan(vite.input.length / 2);
      }
    },
    120_000,
  );

  test("serves the components optimizeComponents rewrote", async () => {
    const { carbon, result } = await bunBuild(
      "docs-site",
      { optimizeCss: false, optimizeComponents: { silent: true } },
      path.join(out, "rewrites"),
    );
    const carbonInputs = Object.keys(result.metafile?.inputs ?? {})
      .map((input) => path.resolve(input))
      .filter((input) => input.includes("carbon-components-svelte"));
    const rewritten = carbonInputs.filter((input) => carbon.load(input));
    expect(rewritten.length).toBeGreaterThan(10);
    // A component Carbon's Button renders only when the app asks for it.
    expect(
      carbonInputs.some((input) => input.endsWith("ButtonSkeleton.svelte")),
    ).toBe(false);
  });

  test("fails when a module outside `content` renders Carbon", async () => {
    const { carbon, result } = await bunBuild(
      "docs-site",
      {
        optimizeComponents: { silent: true, content: ["src/App.svelte"] },
        optimizeCss: { silent: true },
      },
      path.join(out, "outside-content"),
    );
    await expect(carbon.pruneCss({}, result)).rejects.toThrow(OUTSIDE_CONTENT);
  });

  test("needs the metafile", async () => {
    const carbon = optimizeCarbonBun({ optimizeComponents: false });
    await expect(carbon.pruneBuild({ outputs: [] })).rejects.toThrow(
      NEEDS_METAFILE,
    );
  });

  /** Builds docs-site's page: the stylesheet it links, and its size. */
  async function buildPage(options: CarbonBunOptions, name: string) {
    const app = path.join(ROOT, "golden", "docs-site");
    const outdir = path.join(out, name);
    const html = path.join(out, `${name}.html`);
    writeFileSync(
      html,
      readFileSync(path.join(app, "index.html"), "utf8").replace(
        "/src/main.ts",
        path.relative(out, path.join(app, "src/main.ts")),
      ),
    );
    const built = await bunBuild(
      "docs-site",
      {
        optimizeComponents: { silent: true },
        optimizeCss: { silent: true },
        ...options,
      },
      outdir,
      html,
    );
    const page = path.join(outdir, `${name}.html`);
    const linked = () => CSS_LINK.exec(readFileSync(page, "utf8"))?.[1] ?? "";
    const before = linked();
    return {
      ...built,
      outdir,
      before,
      beforeCss: readFileSync(path.join(outdir, before), "utf8"),
      after: () => {
        const name = linked();
        return { name, css: readFileSync(path.join(outdir, name), "utf8") };
      },
    };
  }

  test("prunes Carbon's stylesheet as Carbon ships it, into the CSS that imported it", async () => {
    const page = await buildPage({}, "raw");
    // Bun bundled a marker, not the stylesheet.
    expect(page.beforeCss.length).toBeLessThan(200);

    const renamed = await page.carbon.pruneBuild(page.result);

    const after = page.after();
    expect(after.name).not.toBe(page.before);
    expect(Object.values(renamed)).toEqual([
      path.join(page.outdir, after.name),
    ]);
    expect(readdirSync(page.outdir)).not.toContain(page.before);
    expect(after.css).toContain(".bx--btn");
    expect(after.css).not.toContain(SHEET_MARKER);
    // Bun lowers `inset-inline` to `:lang()` fallbacks; Carbon's file has none.
    expect(after.css).not.toContain(":lang(");
    expect(after.css.length).toBeLessThan(WHITE_CSS.length / 5);
  }, 60_000);

  test('prunes the CSS Bun bundled with `stylesheet: "bundled"`', async () => {
    const raw = await buildPage({}, "raw-size");
    await raw.carbon.pruneBuild(raw.result);
    const page = await buildPage({ stylesheet: "bundled" }, "bundled");
    expect(page.beforeCss).toContain(":lang(");

    await page.carbon.pruneBuild(page.result);

    const after = page.after();
    expect(after.name).not.toBe(page.before);
    expect(after.css.length).toBeLessThan(page.beforeCss.length / 5);
    expect(raw.after().css.length).toBeLessThan(after.css.length);
  }, 60_000);

  test("sets IBM Plex's font-display", async () => {
    const page = await buildPage(
      { optimizeCss: { silent: true, fontDisplay: "swap" } },
      "font-display",
    );
    await page.carbon.pruneBuild(page.result);
    const { css } = page.after();
    expect(css).toContain("font-display:swap");
    expect(css).not.toContain("font-display:auto");
  }, 60_000);
});

describe("createCarbonOptimizer", () => {
  test("fails when a module without a file imports Carbon", async () => {
    const root = path.join(ROOT, "golden", "docs-site");
    const optimizer = createCarbonOptimizer({
      root,
      optimizeComponents: { silent: true },
      optimizeCss: false,
    });
    await optimizer.prepare();
    const button = path.join(
      ROOT,
      "node_modules/carbon-components-svelte/src/Button/Button.svelte",
    );
    expect(typeof optimizer.load(button)?.code).toBe("string");
    await expect(
      optimizer.finish({
        modules: [
          {
            id: "virtual:page",
            imports: [{ id: button, specifier: "carbon-components-svelte" }],
          },
          { id: button, code: readFileSync(button, "utf8") },
        ],
      }),
    ).rejects.toThrow(NO_FILE);
  });
});
