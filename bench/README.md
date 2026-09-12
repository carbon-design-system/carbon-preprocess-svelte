# Benchmarks

[ostia](https://github.com/metonym/ostia) benchmarks for the three hot paths in this package:

- `optimize-css.bench.ts` — `optimizeCssWithReport` against Carbon's real compiled stylesheet (`carbon-components-svelte/css/white.css`), across a small/medium/large import bundle. Runs on every build, once per CSS asset. Further groups cover every branch a CSS asset can take through `createCssOptimizer().run` (a non-Carbon chunk that is skipped, Carbon concatenated with app CSS on the splice path, an `@layer` stylesheet that falls back to PostCSS, and a `Uint8Array` source), the options that add per-selector work (`safelist` strings and RegExps, `contentClasses`, `DatePicker`, `preserveAllIBMFonts`), one optimizer run over a whole four-asset bundle, and `scanContentClasses` over 200 generated source files.
- `optimize-imports.bench.ts` — the `optimizeImports` script preprocessor, across a no-op skip path, a `carbon-` file that is already rewritten, small/medium/large import counts, and mixed specifiers (aliases, `type`, un-indexed utilities). Runs on every `.svelte` file with a `carbon-` substring, on every build and HMR update. The second group appends a 300-line script body: the source map covers every line after the rewritten imports, so on real files the body length dominates, not the import count.
- `build-index.bench.ts` — `buildComponentIndex`, a full re-scan of an installed `carbon-components-svelte` (file scan + CSS indexing + runtime-class graph). Coarser than the other two: it does real file I/O, so treat it as an end-to-end baseline rather than a tight microbenchmark. A second group runs each phase on its own (the `src` walk, `extractFromSvelte` on a small and a large component, `extractCssIndexAdditions` on the real stylesheet, and `buildRuntimeClassMap` with the Svelte import graph pre-scanned, as the full build hands it over). Also prints a one-off phase breakdown (scan / css index / runtime graph) to point at where time goes; the CSS index and runtime graph run concurrently there, so their numbers overlap.

## Running

```sh
bun run bench          # all three
bun run bench:css
bun run bench:imports
bun run bench:index

ostia bench bench/optimize-imports.bench.ts --filter "medium|large"  # run a subset by group/name
```

## Notes

- Numbers are machine-relative, not absolute. Use them to compare before/after a change on the same machine, not across machines.
- `optimize-css` and `build-index` don't mutate shared state between iterations (each call gets a fresh allowlist / index), so results aren't skewed by warm caches inside the library itself — only by the OS file cache for `build-index`.
- When investigating a regression, run the relevant `bench:*` script before and after your change and compare `Median`/`Range`. `--export-json before.json` on the baseline and `ostia compare before.json after.json` gives a noise-aware verdict; `--cpu` adds a hotspot list per task.
- `--alloc` reports retained heap per call after a forced GC, which is near zero for these tasks (nothing survives a call); it does not measure allocation volume.
