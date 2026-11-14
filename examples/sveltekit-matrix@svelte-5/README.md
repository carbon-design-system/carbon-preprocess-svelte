# sveltekit-matrix@svelte-5

> Compares Carbon's bundle with no optimization against each optimization this package offers, in a SvelteKit + Svelte 5 app using the latest `carbon-components-svelte`. The page is prerendered (`@sveltejs/adapter-static`) and hydrated, so `optimizeComponents` has to rewrite the server and client builds alike. Also used for end-to-end testing.

The page ([src/routes/+page.svelte](src/routes/+page.svelte), the same app as [vite-matrix](../vite-matrix@svelte-5)) mixes simple components (Tag, Link, Button), form controls and list boxes (TextInput, Select, Slider, Dropdown, ComboBox, MultiSelect), and complex ones (UI shell header, Tabs, Accordion, DataTable with a toolbar and Pagination, Modal). Some props are literals; others are bound to state.

Each build sets `VARIANT` ([vite.config.ts](vite.config.ts)):

| Variant | Plugins |
| --- | --- |
| `baseline` | `optimizeImports` only |
| `css` | `optimizeCss()`: drops styles of components the app doesn't import |
| `prop-aware` | `optimizeCss({ propAware: true })`: also drops styles for props the app never passes |
| `full` | prop-aware CSS, plus `optimizeComponents()` (which unwraps live branches on Svelte 5): rewrites Carbon components for the props the app passes |

With carbon-components-svelte 0.114.1, `bun run build` printed (client assets only):

| Variant | CSS | CSS gzip | JS | JS gzip |
| --- | --- | --- | --- | --- |
| baseline | 771.89 kB | 93.80 kB | 580.35 kB | 175.63 kB |
| css | 385.11 kB (-50.1%) | 46.38 kB (-50.6%) | 580.35 kB | 175.63 kB |
| prop-aware | 216.81 kB (-71.9%) | 28.64 kB (-69.5%) | 580.35 kB | 175.63 kB |
| full | 216.81 kB (-71.9%) | 28.64 kB (-69.5%) | 437.54 kB (-24.6%) | 140.66 kB (-19.9%) |

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
