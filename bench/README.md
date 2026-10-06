# Benchmarks

[ostia](https://github.com/metonym/ostia) benchmarks for the hot paths in this package:

- `optimize-css.bench.ts` — `optimizeCssWithReport` against Carbon's real compiled stylesheet (`carbon-components-svelte/css/white.css`), across a small/medium/large import bundle. Runs on every build, once per CSS asset. Further groups cover every branch a CSS asset can take through `createCssOptimizer().run` (a non-Carbon chunk that is skipped, Carbon concatenated with app CSS on the splice path, an `@layer` stylesheet on the same splice path, and a `Uint8Array` source), the options that add per-selector work (`safelist` strings and RegExps, `contentClasses`, `DatePicker`, `preserveAllIBMFonts`), one optimizer run over a whole four-asset bundle, `scanContent` over 200 generated source files, `collectCarbonTokens` (the module scan shared by `scanModules` and `scanContent`) over 200 in-memory compiled-module strings plus a 300 kB vendor module with no `bx--` substring to measure the `includes` fast path, and `collectCarbonImports` (the CLI's import scan) over 200 barrel-import sources, the same sources rewritten to direct component paths, and a 300 kB file with no `carbon-components-svelte` substring for its fast path.
- `optimize-imports.bench.ts` — the `optimizeImports` script preprocessor, across a no-op skip path, a `carbon-` file that is already rewritten, small/medium/large import counts, and mixed specifiers (aliases, `type`, un-indexed utilities). Runs on every `.svelte` file with a `carbon-` substring, on every build and HMR update. The second group appends a 300-line script body: the source map covers every line after the rewritten imports, so on real files the body length dominates, not the import count.
- `build-index.bench.ts` — `buildComponentIndex`, a full re-scan of an installed `carbon-components-svelte` (file scan + CSS indexing + runtime-class graph). Coarser than the other two: it does real file I/O, so treat it as an end-to-end baseline rather than a tight microbenchmark. A second group runs each phase on its own (the `src` walk, `extractFromSvelte` on a small and a large component, `extractCssIndexAdditions` on the real stylesheet, and `buildRuntimeClassMap` with the Svelte import graph pre-scanned, as the full build hands it over). Also prints a one-off phase breakdown (scan / css index / runtime graph) to point at where time goes; the CSS index and runtime graph run concurrently there, so their numbers overlap.

- `analyzer.bench.ts` — the usage analysis behind `propAware` and `optimizeComponents`, for a one-Button app, a form with a modal, and the [vite-matrix](../examples/vite-matrix@svelte-5) app (about 90 components rendered): `analyzeFiles` (what `propAware` runs per build) and `specializeFiles` (analysis plus rewriting every rendered component). Component models are cached by path and mtime, so these are warm, as on a watch rebuild; a separate group times modeling every component the large app renders from scratch, which a cold build adds once. A further group runs `optimizeCss` on the real stylesheet with and without prop-aware pruning. The rest cover newer paths: the same app as its two real files (`App.svelte` and its `ActionButton` wrapper), so the app components' own fixpoint runs; `collectAppUsage` over 442 modules (40 wrappers, 400 scripts, a 300 kB vendor file), which is what prop-aware CSS reads every build; and `specializeComponent` against `toSourceMap` for the largest component the app rewrites.
- `optimize-components.bench.ts` — what `optimizeComponents` and `OptimizeComponentsPlugin` add to a build besides the analysis: `prepare` cold and on a watch rebuild with `content` unchanged (a hash check), and `check` over 500 transformed modules looking for Carbon imports from outside `content`.

## Running

```sh
bun run bench          # every suite

ostia bench bench/optimize-css.bench.ts
ostia bench bench/optimize-imports.bench.ts
ostia bench bench/build-index.bench.ts
ostia bench bench/analyzer.bench.ts
ostia bench bench/optimize-components.bench.ts

ostia bench bench/optimize-imports.bench.ts --filter "medium|large"  # run a subset by group/name
```

## In CI

The Benchmark workflow runs every suite on a pull request and on its base, on the same runner, and writes `ostia compare` to the job summary. It's informational, since shared runners are noisy. Pushes to main keep their run as an artifact (`bench-main`), a baseline to compare against later.

## Notes

- Numbers are machine-relative, not absolute. Use them to compare before/after a change on the same machine, not across machines.
- `optimize-css` and `build-index` don't mutate shared state between iterations (each call gets a fresh allowlist / index), so results aren't skewed by warm caches inside the library itself — only by the OS file cache for `build-index`.
- When investigating a regression, run the relevant file with `ostia bench` before and after your change and compare `Median`/`Range`. `--export-json before.json` on the baseline and `ostia compare before.json after.json` gives a noise-aware verdict; `--cpu` adds a hotspot list per task.
- `--alloc` reports retained heap per call after a forced GC, which is near zero for these tasks (nothing survives a call); it does not measure allocation volume.
