# `optimizeComponents`

Rewrites each Carbon component your app renders for the props it passes: values that never change become literals, and branches that can't run go, along with the child components only they render (a skeleton, a tooltip portal). Your own wrapper components are rewritten the same way when every place that renders them is in `content`. It's the JavaScript counterpart of prop-aware pruning, using the same analysis ([svelte-prune](https://github.com/metonym/svelte-prune)).

```js
// vite.config.js
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { optimizeComponents, optimizeCss } from "carbon-preprocess-svelte";

export default {
  plugins: [
    optimizeComponents(), // hands svelte() the rewritten source
    svelte(),
    optimizeCss(),
  ],
};
```

```ts
optimizeComponents({
  /**
   * Globs (relative to the project root: Vite `root`, webpack/Rspack
   * `context`, or the working directory under Rollup) of every file that renders Carbon
   * components. They're analyzed before the build; a module outside them
   * that imports a Carbon component fails the build. Components a script,
   * Markdown, MDX or Astro file imports keep every prop value.
   * `node_modules` is skipped unless a pattern names it.
   * @default ["src/**\/*.{svelte,svx,md,mdx,astro,js,jsx,ts,tsx,mjs,mts,cjs,cts}"]
   */
  content: ["src/**/*.{svelte,ts}"],

  /**
   * Replace an `{#if}` whose live branch is known with that branch instead
   * of keeping an `{#if true}` around it. Svelte 5 only. Saves under a
   * point of JS.
   * @default true when the installed Svelte is 5 or later
   */
  unwrap: true,

  /** Skip the per-build summary. @default false */
  silent: false,

  /**
   * Print what each build rewrote: edits per component, the child
   * components they no longer render and the ones no longer bundled, and
   * the prop values each call site passes. @default false
   */
  report: false,

  /**
   * `false` for an app that only mounts (`mount()`) and never hydrates
   * server-rendered HTML: Svelte 5's client runtime loses its hydration
   * code. Vite, Rollup and Rolldown on Svelte 5 only.
   * @default true
   */
  hydration: true,
});
```

## Client-only apps: `hydration: false`

Svelte 5 ships its hydration code in every client bundle, because the flag that guards it isn't one a bundler can fold. An app that only calls `mount()`, never hydrating server-rendered HTML, can drop it:

```js
optimizeComponents({ hydration: false });
```

The build fails if its output can still call `hydrate()`, so a wrong setting can't ship: SvelteKit with SSR or prerendering, Astro islands (`client:load`), `hydrate` from `svelte`, or a class component from `svelte/legacy`. Leave it on there. Svelte 3 and 4 bundle hydration code only for components compiled with `hydratable`, and webpack and Rspack keep `hydrate()` in every Svelte 5 bundle, so those ignore it with a warning.

In [vite-matrix@svelte-5](../examples/vite-matrix@svelte-5), which only mounts, its `client-only` variant takes gzipped JS from 101.27 kB (`full`) to 99.51 kB, another 1.7%, and behaves identically through the interaction evals.

Where it runs:

| Bundler | Plugin order | Runs on |
| :--- | :--- | :--- |
| Vite, SvelteKit, Astro (`vite.plugins`) | first, automatically | `vite build` and `vite build --watch`; never `vite dev` |
| Rollup, Rolldown | list it before the Svelte plugin | wherever you add it, so add it to production builds only (`content` resolves from the working directory) |
| webpack, Rspack | first, automatically; see [`OptimizeComponentsPlugin`](#optimizecomponentsplugin) | `mode: "production"` (webpack's default) only |

It skips dev servers because it analyzes the whole app up front, dev rebuilds of single modules would leave rewritten components stale, and its safety check needs the complete build.

- **Fails the build instead of shipping wrong code** if a module outside `content` imports a Carbon component (a virtual module, or a dependency in `node_modules`, included), or a wrapper whose props were read from its call sites. Add those files to `content`. It also fails if a file imports Carbon in a way the analysis can't read, such as through a bundler alias (`import { Button } from "@carbon"`): import from `carbon-components-svelte` instead.
- **SvelteKit and Astro:** the server and client builds are rewritten alike, so prerendered pages hydrate as before.
- **Watch mode:** a rebuild reanalyzes `content` only when a file in it changed.
- **Source maps** point devtools and stack traces at the original source.
- **Your wrappers' styles:** a selector only a removed branch could match no longer warns as unused.
- **Same output:** across every Carbon component and prop value, and generated apps that render Carbon through their own wrappers, the rewritten components render identical HTML on Svelte 3, 4 and 5, and every example's optimized build renders the same DOM and pixels through scripted clicks, menus, modals and tooltips.

JavaScript removed in the examples:

| Example | JS removed |
| :--- | :--- |
| [vite-matrix](../examples/vite-matrix@svelte-4), Svelte 4 / 5 | 27% / 20% |
| [SvelteKit](../examples/sveltekit-matrix@svelte-5) | 18% |
| [Astro](../examples/astro) | 14% |
| Rollup, Rolldown, webpack (Svelte 4) | 26–28% |
| webpack, Rspack (Svelte 5) | 9–12% (the Svelte 5 runtime is a larger share of a small app) |

## `OptimizeComponentsPlugin`

`optimizeComponents` for webpack and Rspack, with the same options (`hydration: false` warns and does nothing here: webpack keeps `hydrate()` in every Svelte 5 bundle). It runs in production mode only, and its pre-loader runs before `svelte-loader` wherever the plugin is listed.

```js
// webpack.config.mjs (or rspack.config.mjs)
import {
  OptimizeComponentsPlugin,
  OptimizeCssPlugin,
} from "carbon-preprocess-svelte";

export default {
  plugins: [
    new OptimizeComponentsPlugin(),
    new OptimizeCssPlugin(),
  ],
};
```
