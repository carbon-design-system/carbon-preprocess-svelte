# sveltekit-matrix@svelte-5

> Compares Carbon's bundle with no optimization against each optimization this package offers, in a SvelteKit + Svelte 5 app using the latest `carbon-components-svelte`. The page is prerendered (`@sveltejs/adapter-static`) and hydrated, so `optimizeComponents` has to rewrite the server and client builds alike. Also used for end-to-end testing.

The page ([src/routes/+page.svelte](src/routes/+page.svelte), the same app as [vite-matrix](../vite-matrix@svelte-5)) mixes simple components (Tag, Link, Button), form controls and list boxes (TextInput, Select, Slider, Dropdown, ComboBox, MultiSelect), and complex ones (UI shell header, Tabs, Accordion, DataTable with a toolbar and Pagination, Modal). Some props are literals; others are bound to state.

Each build sets `VARIANT` ([vite.config.ts](vite.config.ts)):

| Variant | Plugins |
| --- | --- |
| `baseline` | `optimizeImports` only |
| `css` | `optimizeCss()`: drops styles of components the app doesn't import |
| `prop-aware` | `optimizeCss({ experimental: { propAware: true } })`: also drops styles for props the app never passes |
| `full` | prop-aware CSS, plus `optimizeComponents()` (which unwraps live branches on Svelte 5): rewrites Carbon components for the props the app passes |

With carbon-components-svelte 0.113.0, `bun run build` printed (client assets only):

| Variant | CSS | CSS gzip | JS | JS gzip |
| --- | --- | --- | --- | --- |
| baseline | 557.37 kB | 65.81 kB | 431.26 kB | 129.49 kB |
| css | 314.97 kB (-43.5%) | 36.33 kB (-44.8%) | 431.26 kB | 129.49 kB |
| prop-aware | 221.54 kB (-60.3%) | 26.18 kB (-60.2%) | 431.26 kB | 129.49 kB |
| full | 221.54 kB (-60.3%) | 26.18 kB (-60.2%) | 352.62 kB (-18.2%) | 112.57 kB (-13.1%) |

## Usage

```sh
# From the repository root: build and link the package
bun run build
bun link

# In this folder
bun link carbon-preprocess-svelte
bun install

# Build every variant and print a size table against baseline
bun run build

# From the repository root: click through every variant in a browser and
# compare its DOM and pixels with baseline after each step
bun run eval:interactions

# Serve one variant to compare by hand
bun run build:full && bun run preview:full
bun run build:baseline && bun run preview:baseline
```
