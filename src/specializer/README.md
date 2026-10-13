# specializer

Reads how an app renders a Svelte component library's components, and rewrites each one for the props the app gives it: values that never change become literals, and branches that can't run go, along with the components only they render. The app's own components are rewritten too when every call site is known. The same analysis says which of the library's CSS classes can render, for a plugin that prunes its stylesheet.

This directory is meant to become its own package. It imports nothing from the rest of this repo and never names Carbon (`tests/specializer-boundary.test.ts` checks both); `carbon-preprocess-svelte` is one consumer, configured in [`src/carbon-library.ts`](../carbon-library.ts).

## Describing a library

```ts
import type { LibrarySpec } from "./library";

const MY_LIBRARY: LibrarySpec = {
  name: "my-library", // the package apps import
  srcDir: "src", // where its modules are
  barrel: "index.js", // its barrel, in `srcDir`
  componentPackages: ["my-library-icons"], // packages whose exports are components
  contextKeyPrefix: "my-library:", // what its context keys start with
  label: "My Library", // names it in messages
  tool: "my-plugin", // names the tool in messages: "my-plugin: …"
  // Optional, for CSS pruning: how class names are read.
  classTokens: { marker: "ml--", text: (text) => [...], script: (code, into) => {} },
};
```

## Entry points

- `specializerPlugin(spec, options, names)`: Vite, Rollup and Rolldown. Production builds only, before Svelte compiles.
- `new SpecializerWebpackPlugin(spec, options, names)`: webpack and Rspack, with the loader in `loader.ts` built as its own file (`names.loader` is its path).
- `./analysis` (loaded lazily by the plugins): `createUsageCollector` for a CSS plugin that collects modules during a build, `analyzeFiles` for a set of files, and `specializeFiles`, which the plugins use. A `UsageResult` says which components can render (`liveComponents`) and which classes can't (`isPruned`).

`names.failure` names the feature in the warning when the analysis fails (`{ feature: "optimizeComponents", fallback: "… were bundled unchanged" }`), and `names.plugin` the plugin in errors.

## What it relies on

Unknown means open: anything the analysis can't read keeps every value, so a missed call site prunes nothing it shouldn't. That needs every module that imports the library to be visible: the plugins analyze `content` before the build and fail it when a module outside `content` imports the library, or imports it in a way the analysis can't read (an alias). A context key or store is followed only when every component that can set or read it is visible, and an app module that reads the library's contexts turns that off.
