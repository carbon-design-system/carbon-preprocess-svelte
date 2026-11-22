# vite-matrix@svelte-5

> Compares Carbon's bundle with no optimization against each optimization this package offers, in one Vite + Svelte 5 app using the latest `carbon-components-svelte`. Also used for end-to-end testing.

The app ([src/App.svelte](src/App.svelte)) mixes simple components (Tag, Link, Button), form controls and list boxes (TextInput, Select, Slider, Dropdown, ComboBox, MultiSelect), and complex ones (UI shell header, Tabs, Accordion, DataTable with a toolbar and Pagination, Modal). Some props are literals; others are bound to state.

Each build sets `VARIANT` ([vite.config.ts](vite.config.ts)):

| Variant | Plugins |
| --- | --- |
| `baseline` | `optimizeImports` only |
| `css` | `optimizeCss()`: drops styles of components the app doesn't render, and of props it never passes |
| `full` | `css`, plus `optimizeComponents()` (which unwraps live branches on Svelte 5): rewrites Carbon components for the props the app passes |
| `client-only` | `full` with `optimizeComponents({ hydration: false })`: the app only mounts ([index.html](index.html)), so Svelte's hydration code goes too |

With carbon-components-svelte 0.114.3, `bun run build` printed:

| Variant | CSS | CSS gzip | JS | JS gzip |
| --- | --- | --- | --- | --- |
| baseline | 772.74 kB | 93.96 kB | 523.84 kB | 152.73 kB |
| css | 167.52 kB (-78.3%) | 22.14 kB (-76.4%) | 523.84 kB | 152.73 kB |
| full | 167.52 kB (-78.3%) | 22.14 kB (-76.4%) | 316.30 kB (-39.6%) | 101.27 kB (-33.7%) |
| client-only | 167.52 kB (-78.3%) | 22.14 kB (-76.4%) | 311.28 kB (-40.6%) | 99.51 kB (-34.8%) |

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
