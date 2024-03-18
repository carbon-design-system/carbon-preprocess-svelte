# carbon-preprocess-svelte

[![NPM][npm]][npm-url]
![GitHub](https://img.shields.io/github/license/ibm/carbon-preprocess-svelte?color=262626&style=for-the-badge)
![npm downloads to date](https://img.shields.io/npm/dt/carbon-preprocess-svelte?color=262626&style=for-the-badge)

> [Svelte preprocessors](https://svelte.dev/docs/svelte-compiler#types-preprocessor) for the Carbon Design System

## Installation

Install `carbon-preprocess-svelte` as a development dependency.

```sh
# Yarn
yarn add -D carbon-preprocess-svelte

# npm
npm i -D carbon-preprocess-svelte

# pnpm
pnpm i -D carbon-preprocess-svelte
```

## Usage

- [**optimizeImports**](#optimizeimports): Svelte preprocessor that rewrites Carbon Svelte imports to their source path in the `script` block, making development compile times dramatically faster.
- [**optimizeCss**](#optimizecss): Vite/Rollup plugin that removes unused Carbon styles, resulting in smaller CSS bundles.

### `optimizeImports`

`optimizeImports` is a Svelte script preprocessor that rewrites base imports from Carbon components/icons/pictograms packages to their source Svelte code paths. This can greatly speed up compile times during development while preserving typeahead and autocompletion offered by integrated development environments (IDE) like VS Code.

The preprocessor optimizes imports from the following packages:

- [carbon-components-svelte](https://github.com/carbon-design-system/carbon-components-svelte)
- [carbon-icons-svelte](https://github.com/carbon-design-system/carbon-icons-svelte)
- [carbon-pictograms-svelte](https://github.com/carbon-design-system/carbon-pictograms-svelte)

```diff
- import { Button } from "carbon-components-svelte";
+ import Button from "carbon-components-svelte/src/Button/Button.svelte";

- import { Add } from "carbon-icons-svelte";
+ import Add from "carbon-icons-svelte/lib/Add.svelte";

- import { Airplane } from "carbon-pictograms-svelte";
+ import Airplane from "carbon-pictograms-svelte/lib/Airplane.svelte";
```

> [!NOTE]
> When this preprocessor was first created, there was no workaround to optimize slow cold start times with Vite in development.
> As of today, [@sveltejs/vite-plugin-svelte](https://github.com/sveltejs/vite-plugin-svelte) enables [`prebundleSvelteLibraries`](https://github.com/sveltejs/vite-plugin-svelte/blob/ba4ac32cf5c3e9c048d1ac430c1091ca08eaa130/docs/config.md#prebundlesveltelibraries), which pre-bundles Svelte libraries to improve cold start times for Vite-based set-ups.
> However, this preprocessor is still useful for non-Vite bundlers, like Rollup and Webpack.

#### SvelteKit

See [examples/sveltekit](examples/sveltekit).

```js
// svelte.config.js
import adapter from "@sveltejs/adapter-static";
import { optimizeImports } from "carbon-preprocess-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [optimizeImports()],
  kit: {
    adapter: adapter(),
  },
};

export default config;
```

#### Vite

See [examples/vite](examples/vite).

```js
// vite.config.js
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { optimizeImports } from "carbon-preprocess-svelte";

/** @type {import('vite').UserConfig} */
export default {
  plugins: [
    svelte({
      preprocess: [optimizeImports()],
    }),
  ],

  // Optional, but recommended for even faster cold starts.
  // Instruct Vite to exclude packages that `optimizeImports` will resolve.
  optimizeDeps: {
    exclude: [
      "carbon-components-svelte",
      "carbon-icons-svelte",
      "carbon-pictograms-svelte",
    ],
  },
};
```

#### Rollup

This code is abridged, see [examples/rollup](examples/rollup) for a full set-up.

```js
// rollup.config.js
import svelte from "rollup-plugin-svelte";
import { optimizeImports } from "carbon-preprocess-svelte";

export default {
  plugins: [
    svelte({
      preprocess: [optimizeImports()],
    }),
  ],
};
```

#### Webpack

This code is abridged, see [examples/webpack](examples/webpack) for a full set-up.

```js
// webpack.config.js
const { optimizeImports } = require("carbon-preprocess-svelte");

module.exports = {
  module: {
    rules: [
      {
        test: /\.svelte$/,
        use: {
          loader: "svelte-loader",
          options: {
            hotReload: !PROD,
            preprocess: [optimizeImports()],
            compilerOptions: { dev: !PROD },
          },
        },
      },
    ],
  },
};
```

### `optimizeCss`

`optimizeCss` is a Vite plugin (Rollup-compatible) that removes unused Carbon styles. This is designed to optimize pre-compiled CSS StyleSheets from `carbon-components-svelte`. At build time, it will remove unused Carbon class selectors from the CSS bundle.

```sh
$ vite build

Optimized index-CU4gbKFa.css
Before: 606.26 kB
After:   53.22 kB (-91.22%)

dist/index.html                  0.34 kB │ gzip:  0.24 kB
dist/assets/index-CU4gbKFa.css  53.22 kB │ gzip:  6.91 kB
dist/assets/index-Ceijs3eO.js   53.65 kB │ gzip: 15.88 kB
```

> [!NOTE]
> This is a plugin and not a Svelte preprocessor. It should be added to the list of `vite.plugins`. For Vite set-ups, this plugin is only run when building the app. For Rollup, you should conditionally apply the plugin.

#### SvelteKit

See [examples/sveltekit](examples/sveltekit).

```js
// vite.config.js
import { sveltekit } from "@sveltejs/kit/vite";
import { optimizeCss } from "carbon-preprocess-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit(), optimizeCss()],
});
```

#### Vite

See [examples/vite](examples/vite).

```js
// vite.config.js
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { optimizeCss } from "carbon-preprocess-svelte";

/** @type {import('vite').UserConfig} */
export default {
  plugins: [svelte(), optimizeCss()],
};
```

#### Rollup

This code is abridged, see [examples/rollup](examples/rollup) for a full set-up.

```js
// rollup.config.js
import svelte from "rollup-plugin-svelte";
import { optimizeCss } from "carbon-preprocess-svelte";

const production = !process.env.ROLLUP_WATCH;

export default {
  plugins: [
    svelte({
      preprocess: [optimizeImports()],
    }),

    // For Rollup, conditionally apply the plugin when building for production.
    production && optimizeCss(),
  ],
};
```

#### Webpack

This code is abridged, see [examples/webpack](examples/webpack) for a full set-up.

```js
// webpack.config.js
const { OptimizeCssPlugin } = require("carbon-preprocess-svelte");

const PROD = process.env.NODE_ENV === "production";

module.exports = {
  plugins: [
    // Conditionally apply the plugin when building for production.
    PROD && new OptimizeCssPlugin(),
  ],
};
```

#### `optimizeCss` API

```ts
type OptimizeCssOptions = {
  /**
   * Set to `false` to disable verbose logging.
   * By default, the plugin will log the size diff
   * between the original and optimized CSS.
   * @default true
   */
  verbose?: boolean;

  /**
   * By default, the pre-compiled Carbon StyleSheet will
   * ship @font-face rules for all available IBM Plex fonts,
   * many of which are not used in the Carbon Svelte components.
   * As such, the default behavior is to only preserve IBM Plex fonts
   * with 400/600-weight and normal-style @font-face rules.
   *
   * Set to `true` to disable this behavior.
   * @default false
   */
  preserveAllIBMFonts?: boolean;

  /**
   * Optionally provide a custom PostCSS plugin.
   * This plugin will be applied after Carbon Svelte CSS is optimized.
   * This is exposed for convenience and maximum flexibility.
   * @see https://postcss.org/docs/postcss-plugins
   */
  postcssPlugin?: postcss.Plugin;
};
```

## Examples

Refer to the [examples](examples) folder for usage with common set-ups.

## Contributing

Refer to the [contributing guidelines](CONTRIBUTING.md).

## License

[Apache 2.0](LICENSE)

[npm]: https://img.shields.io/npm/v/carbon-preprocess-svelte.svg?color=262626&style=for-the-badge
[npm-url]: https://npmjs.com/package/carbon-preprocess-svelte
