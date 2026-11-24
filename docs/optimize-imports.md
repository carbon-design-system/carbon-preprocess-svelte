# `optimizeImports`

Rewrites barrel imports from [carbon-components-svelte](https://github.com/carbon-design-system/carbon-components-svelte), [carbon-icons-svelte](https://github.com/carbon-design-system/carbon-icons-svelte) and [carbon-pictograms-svelte](https://github.com/carbon-design-system/carbon-pictograms-svelte) to their source paths. Svelte compiles less, and your editor keeps its autocomplete.

```diff
- import { Button } from "carbon-components-svelte";
+ import Button from "carbon-components-svelte/src/Button/Button.svelte";

- import { Add } from "carbon-icons-svelte";
+ import Add from "carbon-icons-svelte/lib/Add.svelte";

- import { Airplane } from "carbon-pictograms-svelte";
+ import Airplane from "carbon-pictograms-svelte/lib/Airplane.svelte";
```

- Paths come from your installed Carbon's own `src/index.js`, so they match your version.
- Utilities stay named imports (`import { toCsv } from "carbon-components-svelte/src/DataTable/data-table-utils.js"`), and names the barrel doesn't export stay on the barrel.

> [!NOTE]
> Vite's [`prebundleSvelteLibraries`](https://github.com/sveltejs/vite-plugin-svelte/blob/ba4ac32cf5c3e9c048d1ac430c1091ca08eaa130/docs/config.md#prebundlesveltelibraries), now on by default, covers the same cold-start problem. This preprocessor still helps non-Vite bundlers (Rollup, Webpack) and can shave Vite's cold start further.

**Set-ups:** [SvelteKit](#sveltekit) · [Vite](#vite) · [Rollup](#rollup) · [Webpack](#webpack) · [Rspack](#rspack)

## SvelteKit

Full set-up: [examples/sveltekit](../examples/sveltekit). SvelteKit 3 takes its options in the `sveltekit()` plugin:

```js
// vite.config.js
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { optimizeImports } from "carbon-preprocess-svelte";

export default {
  plugins: [
    sveltekit({
      // In sequence: transpile TypeScript first.
      preprocess: [vitePreprocess(), optimizeImports()],
      adapter: adapter(),
    }),
  ],
};
```

SvelteKit 2: pass the same `preprocess` in `svelte.config.js`, and the adapter under `kit`.

## Vite

Full set-up: [examples/vite](../examples/vite).

```js
// vite.config.js
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { optimizeImports } from "carbon-preprocess-svelte";

export default {
  plugins: [
    // In sequence: transpile TypeScript first.
    svelte({ preprocess: [vitePreprocess(), optimizeImports()] }),
  ],
};
```

## Rollup

Abridged; full set-up: [examples/rollup](../examples/rollup).

```js
// rollup.config.js
import svelte from "rollup-plugin-svelte";
import { optimizeImports } from "carbon-preprocess-svelte";

export default {
  plugins: [svelte({ preprocess: [optimizeImports()] })],
};
```

## Webpack

Abridged; full set-up: [examples/webpack](../examples/webpack).

```js
// webpack.config.mjs
import { optimizeImports } from "carbon-preprocess-svelte";

export default {
  module: {
    rules: [
      {
        test: /\.svelte$/,
        use: {
          loader: "svelte-loader",
          options: { preprocess: [optimizeImports()] },
        },
      },
    ],
  },
};
```

## Rspack

[Rspack](https://rspack.rs) implements webpack's loader API, so the [Webpack](#webpack) set-up works unchanged in `rspack.config.mjs`. Full set-up: [examples/rspack](../examples/rspack).
