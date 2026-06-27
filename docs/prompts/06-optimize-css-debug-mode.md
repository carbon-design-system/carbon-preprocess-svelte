# Add a `debug` mode to `optimizeCss`

> Optimized implementation prompt for `carbon-preprocess-svelte`.
> Priority: P2 · Type: feature (DX) · Est. effort: low

## Context

- `src/plugins/print-diff.ts` already reports the size delta between original and optimized CSS.
- The decision data already exists at optimization time: the tracked `ids` set (`src/plugins/optimize-css.ts`), the computed `allowlist`, `preserveFlatpickr`, and the `removed` count (`src/plugins/create-optimized-css.ts` → `optimizeCssWithReport`).

## Problem

When styles unexpectedly disappear, the consumer has no visibility into *why*: which components were detected, how big the allowlist was, or which selectors were pruned. Today that means filing an issue. A debug surface turns it into self-service.

## Task

1. Add a `debug?: boolean` option to `OptimizeCssOptions`.
2. When enabled, after each CSS asset is processed, log a structured summary:
   - detected Carbon component names (derived from `ids`),
   - allowlist size,
   - `preserveFlatpickr` / `strict` flags,
   - number of rules/selectors removed,
   - a capped sample (e.g. first 20) of pruned selectors.
3. Collect the pruned-selector sample in `create-optimized-css.ts` (extend the existing `report` object) so the plugin can print it; keep it behind the flag to avoid overhead when off.
4. Document `debug` in the `optimizeCss` API section of `README.md`.

## Code example

```ts
optimizeCss({ debug: true });
```

```
[carbon-preprocess-svelte] optimizeCss · assets/index-CU4gbKFa.css
  components detected: Button, DataTable, Modal (3)
  allowlist classes:   214 · strict: false · flatpickr: false
  rules removed:       1180
  sample pruned:       .bx--accordion, .bx--tabs--scrollable__nav-link, …
```

## Acceptance criteria

- [ ] `debug: true` prints the summary per processed CSS asset; default stays quiet.
- [ ] Pruned-selector collection only runs when `debug` is on (no perf cost otherwise).
- [ ] `debug` and `silent` compose sensibly (debug implies output even if `silent`, or document precedence).
- [ ] README documents the option.

## Feedback loop

Run after every change until clean:

```sh
bun lint:fix
bun test
bun run typecheck
```
