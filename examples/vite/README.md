# vite

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

Run the app in development mode. This should only apply the `optimizeImports` preprocessor.

```sh
bun run dev
```

Build the app for production. This should run both the `optimizeImports` and `optimizeCss` preprocessors.

```sh
bun run build
```
