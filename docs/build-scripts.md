# From a build script

## `createCarbonOptimizer`

`optimizeComponents` and `optimizeCss` for a bundler without their plugins, which `optimizeCarbonBun` is built on: call `prepare` before the build, `load` from your Svelte plugin's load step, and `finish` with the module graph and CSS after it. `optimizeCss`' `propAware` prunes from `optimizeComponents`' analysis, as in a Vite build with both, which `optimizeCarbonCss` can't.

```ts
import { createCarbonOptimizer } from "carbon-preprocess-svelte";

const carbon = createCarbonOptimizer({
  /**
   * `content` globs and the installed `carbon-components-svelte` resolve
   * from it.
   * @default process.cwd()
   */
  root: process.cwd(),

  /**
   * `optimizeComponents`' options, or `false` to bundle Carbon's
   * components unchanged.
   * @default {}
   */
  optimizeComponents: {},

  /**
   * `optimizeCss`' options, or `false` to leave CSS unpruned.
   * @default {}
   */
  optimizeCss: {},
});

// Before the build. `resolve` resolves aliased imports as the bundler does.
await carbon.prepare(async (specifier, importer) => undefined);

// In the Svelte plugin, before it compiles: `{ code, map }`, or `undefined`
// to compile the file as it is.
const rewritten = carbon.load("/app/node_modules/carbon-components-svelte/src/Button/Button.svelte");

// After the build: every module it bundled, its CSS, and what else it ships.
const pruned = await carbon.finish({
  modules: [
    {
      id: "/app/src/App.svelte", // absolute path, or a virtual module's name
      code: "…", // its source before Svelte compiles it (`load`'s, if rewritten)
      imports: [{ id: "/app/src/Card.svelte", specifier: "./Card.svelte" }],
      entry: false,
    },
  ],
  css: { "style.css": "…" },
  output: { "index.js": "…", "index.html": "…" },
});
```

## `optimizeCarbonCss`

The engine behind `optimizeCss`, as an async function, for pipelines without a plugin API (esbuild, a post-build script). It can't see your imports, so you pass the `components`. It shares the plugins' [blind spot](optimize-css.md#optimizecss-api). It doesn't see what `optimizeComponents` rewrote, so it keeps more than a Vite build does: for that, use [`createCarbonOptimizer`](#createcarbonoptimizer) (or [`optimizeCarbonBun`](bun.md#optimizecarbonbun) under Bun).

> [!TIP]
> Can your pipeline run a command after the build? The [CLI](cli.md#cli) detects components for you, with no code.

```js
// esbuild
import { writeFileSync } from "node:fs";
import { optimizeCarbonCss } from "carbon-preprocess-svelte";
import { build } from "esbuild";

const result = await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  write: false,
  outdir: "dist",
});

const components = ["Button", "Accordion"];
const sources = result.outputFiles
  .filter((file) => file.path.endsWith(".js"))
  .map((file) => file.text);

for (const file of result.outputFiles) {
  if (!file.path.endsWith(".css")) continue;
  const { css } = await optimizeCarbonCss(file.text, { components, sources });
  writeFileSync(file.path, css);
}
```

<details>
<summary><code>Bun.build</code></summary>

```js
import { optimizeCarbonCss } from "carbon-preprocess-svelte";

const result = await Bun.build({ entrypoints: ["src/main.js"], outdir: "dist" });

const components = ["Button", "Accordion"];
const sources = await Promise.all(
  result.outputs
    .filter((output) => output.kind === "entry-point" || output.kind === "chunk")
    .map((output) => output.text()),
);

for (const output of result.outputs) {
  if (!output.path.endsWith(".css")) continue;
  const { css } = await optimizeCarbonCss(await output.text(), {
    components,
    sources,
  });
  await Bun.write(output.path, css);
}
```

</details>

```ts
optimizeCarbonCss(css, {
  /**
   * Carbon components used by the app, as names (`"Button"`) or paths to
   * their `.svelte` source. Classes referenced by these components are kept.
   * An empty list returns the CSS unchanged.
   */
  components: ["Button", "Accordion"],

  /**
   * Source code to scan for literal `bx--` tokens, for example the JS output
   * of your bundler. Same detection as the plugins' `scanModules`. When
   * given, it should be everything the app ships besides this CSS: Carbon
   * tokens (`--cds-*`) that neither it nor the CSS reads are removed too.
   * @default undefined
   */
  sources: [],

  /**
   * Project directory: `content` globs and the installed
   * `carbon-components-svelte` resolve from it.
   * @default process.cwd()
   */
  cwd: process.cwd(),

  /**
   * Class selectors to always keep, regardless of which components are
   * imported. See the `optimizeCss` API above for the string vs. `RegExp`
   * matching rules.
   * @default []
   */
  safelist: [".bx--grid", ".bx--aspect-ratio", /^\.bx--btn--/],

  /**
   * Set to `true` to retain *all* IBM Plex `@font-face` rules instead of
   * only the ones Carbon Svelte components actually use.
   * @default false
   */
  preserveAllIBMFonts: false,

  /**
   * The `font-display` of the IBM Plex `@font-face` rules, as `optimizeCss`'.
   * @default unchanged ("auto")
   */
  fontDisplay: "swap",

  /**
   * Glob patterns of source files to scan for literal `bx--`-prefixed
   * tokens. Every token found is kept. Resolves relative to `cwd`.
   * @default undefined
   */
  content: ["src/**/*.{svelte,js,ts}"],

  /**
   * See "Pruning by props" under `optimizeCss`. Call sites are read from
   * the `content` files, so `content` must cover every file that renders
   * Carbon components; a listed component no file renders keeps every
   * variant. Without `content`, each listed component renders with any
   * props.
   * @default []
   */
  exclude: ["DataTable"],
});
```
