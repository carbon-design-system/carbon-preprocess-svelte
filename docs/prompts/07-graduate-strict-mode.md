# Graduate `experimental.strict` toward stable

> Optimized implementation prompt for `carbon-preprocess-svelte`.
> Priority: P2 · Type: feature · Est. effort: medium

## Context

- Strict CSS tree-shaking lives behind `experimental.strict` in `src/plugins/create-optimized-css.ts` and is implemented in `src/plugins/strict-css-optimizer.ts`.
- It has a dedicated fixture suite (`tests/optimize-css-fixtures.test.ts`) and a long tail of refinement commits (e.g. "require all Carbon classes in multi-class strict selectors", "exempt context ancestors", per-component zero-leak baselines).

## Problem

Strict mode delivers the largest bundle savings but is undiscoverable (nested under `experimental`) and its tradeoffs aren't surfaced. There is no path-to-stable and the size diff log doesn't tell users they're leaving savings on the table.

## Task

1. **Discoverability:** in the `optimizeCss` diff log (`print-diff.ts`), when strict is *off*, optionally hint that strict mode may reduce size further (one-time, suppressible via `silent`).
2. **Docs:** add a dedicated "Strict mode" subsection to `README.md` documenting exactly what it prunes (selector-list pruning, all-classes-must-match compounds, flatpickr/legacy `bx-` dropping, parenthesis-aware `:is()` parsing) and the risk profile.
3. **Stability plan:** add a short `## Deprecations / roadmap` note proposing `strict` graduate to a top-level `strict?: boolean` option (keeping `experimental.strict` as a deprecated alias) in the next minor, and become the default in the next major.
4. Do **not** change default behavior in this change; this is about discoverability + a documented plan.

## Code example

```ts
// today
optimizeCss({ experimental: { strict: true } });

// proposed (alias kept for back-compat)
optimizeCss({ strict: true });
```

## Acceptance criteria

- [ ] Strict-mode behavior is unchanged; all fixtures pass.
- [ ] README has a clear "Strict mode" section with prune rules and tradeoffs.
- [ ] A non-breaking discoverability hint exists and respects `silent`.
- [ ] A written graduation/deprecation plan is recorded (README or CHANGELOG note).

## Feedback loop

Run after every change until clean:

```sh
bun lint:fix
bun test
bun run typecheck
```
