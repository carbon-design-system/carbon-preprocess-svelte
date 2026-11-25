# carbon-preprocess-svelte

Zero-dependency Svelte preprocessors and build plugins for the Carbon Design System

It makes a [carbon-components-svelte](https://github.com/carbon-design-system/carbon-components-svelte) app ship less: it rewrites Carbon's barrel imports so Svelte compiles less, prunes the Carbon CSS your components never render, and rewrites Carbon components for the props your app actually passes. It reads your installed Carbon, so it matches your version. Its one blind spot: a Carbon class your code builds at run time, never written as a literal `bx--` token, gets pruned, so name it in `safelist`.

One app, built five ways ([examples/vite-matrix@svelte-5](https://github.com/carbon-design-system/carbon-preprocess-svelte/tree/main/examples/vite-matrix@svelte-5)):

| Variant | CSS gzip | JS gzip |
| --- | --- | --- |
| `optimizeImports` only | 93.96 kB | 152.73 kB |
| `optimizeCss({ propAware: false })` | 44.01 kB (-53.2%) | 152.73 kB |
| `optimizeCss()` | 22.14 kB (-76.4%) | 152.73 kB |
| plus `optimizeComponents()` | 22.14 kB (-76.4%) | 101.27 kB (-33.7%) |
| plus `hydration: false` | 22.14 kB (-76.4%) | 99.51 kB (-34.8%) |

**Every build says what it pruned:**

```console
$ vite build
…
carbon-preprocess-svelte: pruned Carbon CSS
  assets/index-CU4gbKFa.css  606.3 kB  →  53.2 kB  -91%
```

It has no dependencies, and runs on Node 22 or later, or Bun.

## Quick start

```sh
npm i -D carbon-preprocess-svelte
```

```js
// vite.config.js, for SvelteKit 3 (which takes its options in sveltekit())
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import {
  optimizeComponents,
  optimizeCss,
  optimizeImports,
} from "carbon-preprocess-svelte";

export default {
  plugins: [
    optimizeComponents(), // before sveltekit(), which compiles what it rewrites
    sveltekit({
      preprocess: [vitePreprocess(), optimizeImports()],
      adapter: adapter(),
    }),
    optimizeCss(),
  ],
};
```

```sh
npx vite build    # prints the pruned stylesheets, as above
```

## Pick a tool

Each works on its own.

| Tool | For | Does |
| --- | --- | --- |
| [`optimizeImports`](https://github.com/carbon-design-system/carbon-preprocess-svelte/blob/main/docs/optimize-imports.md) | any bundler, as a Svelte preprocessor | rewrites Carbon imports to source paths |
| [`optimizeCss`](https://github.com/carbon-design-system/carbon-preprocess-svelte/blob/main/docs/optimize-css.md) | Vite, SvelteKit, Astro, Rollup, Rolldown | prunes unused Carbon styles |
| [`OptimizeCssPlugin`](https://github.com/carbon-design-system/carbon-preprocess-svelte/blob/main/docs/optimize-css.md#optimizecssplugin) | Webpack, Rspack | `optimizeCss` for Webpack and Rspack |
| [`optimizeComponents`](https://github.com/carbon-design-system/carbon-preprocess-svelte/blob/main/docs/optimize-components.md) | Vite, SvelteKit, Astro, Rollup, Rolldown | rewrites Carbon components for the props your app passes |
| [`OptimizeComponentsPlugin`](https://github.com/carbon-design-system/carbon-preprocess-svelte/blob/main/docs/optimize-components.md#optimizecomponentsplugin) | Webpack, Rspack | `optimizeComponents` for Webpack and Rspack |
| [`optimizeCarbonBun`](https://github.com/carbon-design-system/carbon-preprocess-svelte/blob/main/docs/bun.md) | `Bun.build` | `optimizeComponents` and `optimizeCss` for Bun |
| [`createCarbonOptimizer`](https://github.com/carbon-design-system/carbon-preprocess-svelte/blob/main/docs/build-scripts.md#createcarbonoptimizer) | any bundler without the plugins above | both, driven by your build script |
| [`optimizeCarbonCss`](https://github.com/carbon-design-system/carbon-preprocess-svelte/blob/main/docs/build-scripts.md#optimizecarboncss) | esbuild, any post-build script | the CSS pruning as a function |
| [CLI](https://github.com/carbon-design-system/carbon-preprocess-svelte/blob/main/docs/cli.md) | any pipeline without a plugin hook | prunes built CSS files with one command |

Without a plugin hook, run the CLI after the build:

```sh
npx carbon-preprocess-svelte optimize-css "dist/**/*.css"
npx carbon-preprocess-svelte optimize-css "dist/**/*.css" --dry-run --json
```

It exits `0` when done and `2` when called wrong or there's nothing to prune; `--json` prints the result, or the error, as one object on stdout.

## Docs

- [`optimizeImports`](https://github.com/carbon-design-system/carbon-preprocess-svelte/blob/main/docs/optimize-imports.md): set-ups for SvelteKit, Vite, Rollup, Webpack and Rspack
- [`optimizeCss`](https://github.com/carbon-design-system/carbon-preprocess-svelte/blob/main/docs/optimize-css.md): set-ups, how it prunes, its options, prop-aware pruning, and `OptimizeCssPlugin`
- [`optimizeComponents`](https://github.com/carbon-design-system/carbon-preprocess-svelte/blob/main/docs/optimize-components.md): what it rewrites, client-only apps, and `OptimizeComponentsPlugin`
- [Bun](https://github.com/carbon-design-system/carbon-preprocess-svelte/blob/main/docs/bun.md): `optimizeCarbonBun`
- [From a build script](https://github.com/carbon-design-system/carbon-preprocess-svelte/blob/main/docs/build-scripts.md): `createCarbonOptimizer` and `optimizeCarbonCss`
- [CLI](https://github.com/carbon-design-system/carbon-preprocess-svelte/blob/main/docs/cli.md): the command, its output, and every option
- [Component index](https://github.com/carbon-design-system/carbon-preprocess-svelte/blob/main/docs/component-index.md): how it reads your installed Carbon
- [Examples](https://github.com/carbon-design-system/carbon-preprocess-svelte/tree/main/examples): a runnable set-up for every supported bundler
