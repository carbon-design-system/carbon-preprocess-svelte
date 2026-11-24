# `optimizeCss`

A build plugin that strips unused Carbon styles. It runs on Vite, Rollup and [Rolldown](https://rolldown.rs), which share a plugin API.

```
$ vite build
…
carbon-preprocess-svelte: pruned Carbon CSS
  assets/index-CU4gbKFa.css  606.3 kB  →  53.2 kB  -91%
```

> [!NOTE]
> It's a build plugin, not a preprocessor: add it to `plugins`. Vite runs it on `vite build` only; under Rollup and Rolldown, add it to production builds only.

<details>
<summary>How it works</summary>

It runs on production builds, after other plugins (`apply: "build"`, `enforce: "post"`).

1. **`transform`:** collects the Carbon components the app imports, and (unless `scanModules: false`) every literal `bx--` token in other modules.
2. **`renderStart`:** before chunks are hashed, reads the call sites (`propAware`) and folds a hash of everything the pruning depends on into the names of the chunks whose code names CSS files (the preload lists of dynamic imports), so they change when the pruning does.
3. **`generateBundle`:** for each CSS file, builds an allowlist of the `bx--` classes those components use, plus globals like `.bx--body`. The class index comes from your installed Carbon (see [Component index](component-index.md#component-index)).
4. **Prune** Carbon selectors outside the allowlist:
   - from a selector list, only the branches that don't match;
   - a compound selector only survives if every Carbon class in it does, so NumberInput doesn't pull in `.bx--modal .bx--number`;
   - flatpickr and legacy `bx-` rules go unless a flatpickr-based component (DatePicker) is bundled;
   - `:is(…)` and `:not(…)` groups are parsed, not split on commas.
5. Empty rules are dropped.
6. **Carbon tokens** (`--cds-*` custom properties) that nothing reads are removed. A token stays if a `var()` in the kept CSS reads it, a kept token's value reads it, or the bundle's scripts or markup (or `content` files) name it. Carbon 0.114 defines about 400 of them, and an app typically reads a few dozen.
7. **Renames** each pruned file whose name hashes its content (`assets/index-[hash].css`) to a hash of the pruned CSS, and updates the HTML, chunks and Vite manifest that name it. Two builds that prune differently never share a file name, so long-lived caching (`Cache-Control: immutable`) is safe. Under Vite this runs before other plugins' `generateBundle`, so Vite's HTML and Astro's pages see the new names.

Validated against most Carbon components and common multi-component bundles with no unexplained survivors. Its one blind spot is in the warning under the [API](#optimizecss-api): class names that never appear as a literal `bx--` token.

```mermaid
flowchart TB
  subgraph scan["Module scan"]
    T[transform hook] --> S["Collect imported Carbon<br/>component paths"]
  end
  subgraph emit["Bundle phase"]
    S --> G[generateBundle]
    G --> A["Allowlist bx-- selectors<br/>(index + .bx--body)"]
    A --> P[Prune unused Carbon styles]
    P --> R[Optimize CSS assets]
  end

  class T,G hook
  class S,A data
  class P,R css
```

</details>

**Set-ups:** [SvelteKit](#sveltekit) · [Astro](#astro) · [Vite](#vite) · [Rollup](#rollup) · [Rolldown](#rolldown) · [API reference](#optimizecss-api)

## SvelteKit

Full set-up: [examples/sveltekit](../examples/sveltekit).

```js
// vite.config.js
import { sveltekit } from "@sveltejs/kit/vite";
import { optimizeCss } from "carbon-preprocess-svelte";

export default {
  plugins: [sveltekit(), optimizeCss()],
};
```

## Astro

Full set-up: [examples/astro](../examples/astro).

```js
// astro.config.mjs
import svelte from "@astrojs/svelte";
import { optimizeCss } from "carbon-preprocess-svelte";
import { defineConfig } from "astro/config";

export default defineConfig({
  integrations: [svelte()],
  // Optional: keep CSS in its own file, so the pruned output is easy to inspect.
  build: { inlineStylesheets: "never" },
  vite: { plugins: [optimizeCss()] },
});
```

## Vite

Full set-up: [examples/vite](../examples/vite).

```js
// vite.config.js
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { optimizeCss } from "carbon-preprocess-svelte";

export default {
  plugins: [svelte(), optimizeCss()],
};
```

## Rollup

Abridged; full set-up: [examples/rollup](../examples/rollup).

```js
// rollup.config.js
import svelte from "rollup-plugin-svelte";
import { optimizeCss, optimizeImports } from "carbon-preprocess-svelte";

const production = !process.env.ROLLUP_WATCH;

export default {
  plugins: [
    svelte({ preprocess: [optimizeImports()] }),
    production && optimizeCss(), // production builds only
  ],
};
```

## Rolldown

Abridged; full set-up: [examples/rolldown](../examples/rolldown).

```js
// rolldown.config.ts
import { optimizeCss, optimizeImports } from "carbon-preprocess-svelte";
import svelte from "rollup-plugin-svelte";

const production = process.env.NODE_ENV === "production";

export default {
  plugins: [
    svelte({ preprocess: [optimizeImports()] }),
    production && optimizeCss(), // production builds only
  ],
};
```

## `optimizeCss` API

```ts
optimizeCss({
  /**
   * Set to `true` to suppress the size difference
   * logging between original and optimized CSS.
   * Under Vite the size log also follows `logLevel` and `customLogger`,
   * so `--logLevel warn` hides it without setting `silent`.
   * @default false
   */
  silent: true,

  /**
   * Run the whole pipeline and print the size log, but leave every CSS
   * asset unchanged. Use it to preview the reduction and check the output
   * before enabling pruning in a production build.
   * @default false
   */
  dryRun: true,

  /**
   * Print a per-build summary of what the plugin detected: imported Carbon
   * components, allowlist size and its sources (module scan, `content`,
   * `safelist`), and per-asset results. Independent of `silent`.
   * @default false
   */
  report: true,

  /**
   * By default, pre-compiled Carbon StyleSheets ship `@font-face` rules
   * for all available IBM Plex fonts, many of which are not actually
   * used in Carbon Svelte components.
   *
   * The default behavior is to preserve the following IBM Plex fonts:
   * - IBM Plex Sans (300/400/600-weight rules; italic only if `<Text italic>` is used)
   * - IBM Plex Mono (400-weight and normal-font-style rules)
   *
   * Set to `true` to disable this behavior and
   * retain *all* IBM Plex `@font-face` rules.
   * @default false
   */
  preserveAllIBMFonts: true,

  /**
   * The `font-display` of the IBM Plex `@font-face` rules the CSS keeps.
   * Carbon's stylesheets ship `auto`, which in most browsers hides text
   * for up to three seconds while the font loads from IBM's CDN; `swap`
   * shows it in a fallback font until then.
   * @default unchanged ("auto")
   */
  fontDisplay: "swap",

  /**
   * Class selectors to always keep, regardless of which components are
   * imported. Use for Carbon classes the allowlist misses: hand-written
   * classes in app markup (e.g. `<div class="bx--grid">`) and theme/layout
   * utilities that no component file references.
   *
   * Each entry is either:
   * - a `string`, matched literally as a complete class token. `.bx--grid`
   *   keeps `.bx--grid` and `.bx--grid:hover`, but not `.bx--grid--wide`
   * - a `RegExp`, tested against the whole selector. `/^\.bx--btn--/` keeps
   *   every `.bx--btn--*` variant
   *
   * @default []
   */
  safelist: [".bx--grid", ".bx--aspect-ratio", /^\.bx--btn--/],

  /**
   * Glob patterns (relative to the project root: Vite `root`, webpack/Rspack
   * `context`, or the working directory under plain Rollup) of source files
   * to scan for literal `bx--`-prefixed tokens. Every token found is kept.
   * Use when class names are built at runtime. See the warning below.
   *
   * A pattern that matches no files raises a bundler warning naming the root
   * it was resolved from.
   *
   * @default undefined
   */
  content: ["src/**/*.{svelte,js,ts}"],

  /**
   * Scan the code of every bundled module for literal `bx--` tokens and keep
   * them, so hand-written Carbon classes in your own markup
   * (`<div class="bx--grid">`) and prefix literals (`` `bx--btn--${kind}` ``)
   * survive without configuration. Carbon's own sources, CSS modules, and
   * virtual modules are skipped. Set to `false` to rely only on imported
   * components, `safelist`, and `content`.
   * @default true
   */
  scanModules: false,

  /**
   * Also prune styles for the prop values the app never passes.
   * See "Prop-aware pruning" below. Set to `false` to prune by the
   * imported components alone.
   * @default true
   */
  propAware: false,
});
```

> [!WARNING]
> **A class name that never appears as a literal `bx--` token can't be detected**, and gets pruned:
>
> ```svelte
> <script>
>   const p = "bx-" + "-btn"; // "bx--btn" never appears as one token
> </script>
> <button class={`${p}--${kind}`}>...</button>
> ```
>
> The same goes for files the bundler never processes (Markdown, HTML templates, CMS content). Fixes:
>
> | Fix | Example |
> | :--- | :--- |
> | Keep selectors explicitly | `safelist: [".bx--grid", /^\.bx--btn--/]` |
> | Scan extra files for tokens | `content: ["**/*.{md,html}"]` |
> | See what was detected | `report: true` |
>
> Carbon tokens work the same way: one read only outside the bundle (a stylesheet in `public/`, a CMS template) is removed unless `content` covers that file. A name built at runtime keeps every token whose name starts with the literal part (`` `--cds-${name}` `` keeps them all).

## Prop-aware pruning

By default, `optimizeCss` also reads the props your app passes, and prunes the variants it never uses. It reads which components render, too, so barrel imports (`import { Button } from "carbon-components-svelte"`) prune as well as `optimizeImports` paths do. To prune by the imported components alone:

```js
optimizeCss({ propAware: false });
```

```svelte
<Button kind="tertiary">Save</Button>
<!-- kept:   .bx--btn, .bx--btn--tertiary
     pruned: the other kinds and sizes, .bx--skeleton, the icon-only tooltip -->
```

What it reads:

| In your app | Example |
| :--- | :--- |
| Literal props | `<Button kind="ghost">` |
| Constants, and state no code reassigns | `const kind = "ghost"`, `let size = $state("small")`, or a string or number your own modules export: `import { KIND } from "./constants"` |
| Your own wrapper components | `<ActionButton primary>` reaching `<Button kind={primary ? "tertiary" : "ghost"}>` |
| Props Carbon passes to its own children | `Modal` rendering `Button` |
| Props a component forwards to a child | `{...$$restProps}`, or `...rest` from `$props()` |
| Object and array literals nothing changes | `secondaryButtons={[{ text: "Back", kind: "ghost" }]}`, read as `button.kind` in `{#each}` |
| Your own `{#if}` and `{#each}` | a call site in a branch that can't render doesn't count |

What keeps every variant (it errs toward keeping styles):

| Case | Example |
| :--- | :--- |
| A value it can't read | a reassigned variable, a store, a function call |
| `bind:`, or spreading anything but a component's own props | `bind:open`, `{...props}` |
| A component used as a value | `<svelte:component this={Button}>`, passed as a prop, imported in a `.js`/`.ts` file |
| Markup it can't see | imported but never rendered as a tag (another preprocessor's output) |
| A wrapper rendered from outside the analyzed files | a route or entry the framework mounts, `import.meta.glob` |

Imports through an alias (`#lib/Card.svelte` in SvelteKit 3, `$lib/Card.svelte` before it) are resolved with the bundler's own resolver. Without a bundler (`optimizeCarbonCss`, the CLI), a component imported through an alias renders with any props. If the analysis fails, the build warns and prunes without it. To tune it:

```js
optimizeCss({
  propAware: {
    // Keep every variant's styles for these components.
    exclude: ["DataTable"],
    // Values for props set from expressions; a value not listed loses its styles.
    assume: { Button: { kind: ["primary", "danger"] } },
  },
});
```

`report: true` prints each component's prop values, and for each value it can't read, where and why it was lost:

```
Button (4 call sites)
  kind             dynamic (+ default): Modal.svelte:279 reads `button.kind`
DataTable (1 call site)
  page             dynamic: App.svelte:231 `page` is bound with `bind:` at line 253
```

The same options work on `OptimizeCssPlugin`, `createCarbonOptimizer`'s `optimizeCss`, and `optimizeCarbonCss` (which needs `content`). The CLI's `--prop-aware` turns it on without `exclude` or `assume`.

Across 2,416 apps covering every Carbon component and prop value, it left 46% less CSS than default pruning, and no class those apps render lost its rules. To also remove the code for the pruned branches, add [`optimizeComponents`](optimize-components.md#optimizecomponents).

## `OptimizeCssPlugin`

`optimizeCss` for Webpack and [Rspack](https://rspack.rs): same options, production mode only. One instance works on both, since Rspack implements webpack's plugin API.

```js
// webpack.config.mjs (or rspack.config.mjs)
import { OptimizeCssPlugin } from "carbon-preprocess-svelte";

export default {
  plugins: [new OptimizeCssPlugin()],
};
```

Full set-ups: [examples/webpack](../examples/webpack), [examples/webpack@svelte-5](../examples/webpack@svelte-5), [examples/rspack](../examples/rspack).

It prunes before `optimization.realContentHash` (on by default in production mode) hashes the files, so `[contenthash]` names follow the pruned CSS. With `realContentHash: false`, a name can stay the same across builds that prune differently.
