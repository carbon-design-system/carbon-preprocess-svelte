# Benchmarks

[ostia](https://github.com/metonym/ostia) benchmarks for the three hot paths in this package:

- `optimize-css.bench.ts` — `optimizeCssWithReport` against Carbon's real compiled stylesheet (`carbon-components-svelte/css/white.css`), across a small/medium/large import bundle. Runs on every build, once per CSS asset.
- `optimize-imports.bench.ts` — the `optimizeImports` script preprocessor, across a no-op skip path and small/medium/large import counts. Runs on every `.svelte` file with a `carbon-` substring, on every build and HMR update.
- `build-index.bench.ts` — `buildComponentIndex`, a full re-scan of an installed `carbon-components-svelte` (file scan + CSS indexing + runtime-class graph). Coarser than the other two: it does real file I/O, so treat it as an end-to-end baseline rather than a tight microbenchmark. Also prints a one-off phase breakdown (scan / css index / runtime graph) to point at where time goes.

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
- When investigating a regression, run the relevant `bench:*` script before and after your change and compare `Mean`/`Min…Max`.
