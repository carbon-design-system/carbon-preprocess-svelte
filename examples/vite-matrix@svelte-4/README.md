# vite-matrix@svelte-4

> Compares Carbon's bundle with no optimization against each optimization this package offers, in one Vite + Svelte 4 app using the latest `carbon-components-svelte`. Also used for end-to-end testing.

The app ([src/App.svelte](src/App.svelte)) mixes simple components (Tag, Link, Button), form controls and list boxes (TextInput, Select, Slider, Dropdown, ComboBox, MultiSelect), and complex ones (UI shell header, Tabs, Accordion, DataTable with a toolbar and Pagination, Modal). Some props are literals; others are bound to state.

Each build sets `VARIANT` ([vite.config.ts](vite.config.ts)):

| Variant | Plugins |
| --- | --- |
| `baseline` | `optimizeImports` only |
| `css` | `optimizeCss()`: drops styles of components the app doesn't import |
| `prop-aware` | `optimizeCss({ propAware: true })`: also drops styles for props the app never passes |
| `full` | prop-aware CSS, plus `optimizeComponents()`: rewrites Carbon components for the props the app passes |

With carbon-components-svelte 0.114.1, `bun run build` printed:

| Variant | CSS | CSS gzip | JS | JS gzip |
| --- | --- | --- | --- | --- |
| baseline | 774.07 kB | 93.99 kB | 882.38 kB | 247.25 kB |
| css | 386.33 kB (-50.1%) | 46.43 kB (-50.6%) | 882.38 kB | 247.25 kB |
| prop-aware | 217.89 kB (-71.9%) | 28.69 kB (-69.5%) | 882.38 kB | 247.25 kB |
| full | 217.89 kB (-71.9%) | 28.69 kB (-69.5%) | 570.79 kB (-35.3%) | 174.17 kB (-29.6%) |

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
