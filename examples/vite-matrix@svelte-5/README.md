# vite-matrix@svelte-5

> Compares Carbon's bundle with no optimization against each optimization this package offers, in one Vite + Svelte 5 app using the latest `carbon-components-svelte`. Also used for end-to-end testing.

The app ([src/App.svelte](src/App.svelte)) mixes simple components (Tag, Link, Button), form controls and list boxes (TextInput, Select, Slider, Dropdown, ComboBox, MultiSelect), and complex ones (UI shell header, Tabs, Accordion, DataTable with a toolbar and Pagination, Modal). Some props are literals; others are bound to state.

Each build sets `VARIANT` ([vite.config.ts](vite.config.ts)):

| Variant | Plugins |
| --- | --- |
| `baseline` | `optimizeImports` only |
| `css` | `optimizeCss()`: drops styles of components the app doesn't import |
| `prop-aware` | `optimizeCss({ propAware: true })`: also drops styles for props the app never passes |
| `full` | prop-aware CSS, plus `optimizeComponents()` (which unwraps live branches on Svelte 5): rewrites Carbon components for the props the app passes |

With carbon-components-svelte 0.114.2, `bun run build` printed:

| Variant | CSS | CSS gzip | JS | JS gzip |
| --- | --- | --- | --- | --- |
| baseline | 772.74 kB | 93.96 kB | 523.84 kB | 152.73 kB |
| css | 385.15 kB (-50.2%) | 46.40 kB (-50.6%) | 523.84 kB | 152.73 kB |
| prop-aware | 216.81 kB (-71.9%) | 28.64 kB (-69.5%) | 523.84 kB | 152.73 kB |
| full | 216.81 kB (-71.9%) | 28.64 kB (-69.5%) | 350.41 kB (-33.1%) | 110.75 kB (-27.5%) |

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
