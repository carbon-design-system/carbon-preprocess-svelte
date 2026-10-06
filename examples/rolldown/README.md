# rolldown

> Used for end-to-end testing and development purposes.

## Quick Start

```sh
# First, build the library locally
bun run build

# Create a local link to the library
bun link

# When developing, rebuild the library when making changes
bun run build -w
```

In this folder, you can run the following commands:

```sh
# Install dependencies
bun i
```

Run the app in development mode. This should only apply the `optimizeImports` preprocessor. Rolldown has no built-in dev server, so this also starts a [`deserved`](https://www.npmjs.com/package/deserved) static server with live reload on `http://localhost:3000`.

```sh
bun run dev
```

Build the app for production. This should run both the `optimizeImports` and `optimizeCss` preprocessors. The CSS file is content-hashed (e.g. `bundle-<hash>.css`); `index.html` (a template — the served `public/` dir is gitignored and regenerated on every build) is rewritten with the real filename.

```sh
bun run build
```

Build with the component optimizations too: `optimizeComponents` rewrites Carbon components for the props the app passes, and prop-aware `optimizeCss` prunes their unused styles. Output goes to `public-optimized/`.

```sh
bun run build:optimized
bun run preview:optimized
```

Serve the production build.

```sh
bun run preview
```
