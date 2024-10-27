# webpack

> Used for end-to-end testing and development purposes.

## Quick Start

```sh
# Rebuild the library when making changes
bun prepack -w

# Create a local link to the library
bun link
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
