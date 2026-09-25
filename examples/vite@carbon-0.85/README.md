# vite@carbon-0.85

> Used for end-to-end testing and development purposes.

Same set-up as [examples/vite](../vite), but pinned to `carbon-components-svelte@0.85.0` so the end-to-end tests cover an older Carbon install. That release re-exports each component through its folder's `index.js`, and its `Tabs` markup uses classes newer releases dropped, so both `optimizeImports` and `optimizeCss` have to read the installed version rather than assume the latest.

Keep `carbon-components-svelte` pinned to an exact version: `bun run upgrade-examples` only updates within each range.

## Quick Start

```sh
# First, build the library locally
bun run build

# Create a local link to the library
bun link
```

In this folder, you can run the following commands:

```sh
# Install dependencies
bun i

# Build the app for production (runs `optimizeImports` and `optimizeCss`)
bun run build
```
