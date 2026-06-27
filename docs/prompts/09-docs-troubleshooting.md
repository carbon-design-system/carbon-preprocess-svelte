# Docs: troubleshooting section

> Optimized implementation prompt for `carbon-preprocess-svelte`.
> Priority: P3 · Type: docs · Est. effort: low

## Context

The codebase implies several predictable failure modes that aren't documented:

- `optimizeCss` prunes Carbon classes not referenced by an imported component file (`buildUsage` in `src/plugins/create-optimized-css.ts`) → hand-written/dynamic classes vanish.
- The component index is pinned to a specific `carbon-components-svelte` version → wrong import paths or pruned classes after a Carbon upgrade.
- `optimizeImports` requires TypeScript to be transpiled first — currently only an inline comment in `README.md` examples ("If using TypeScript, the code must be transpiled first").

## Problem

When these happen, consumers have no guidance and tend to file issues or abandon the plugin. A troubleshooting section turns each into a self-serve fix.

## Task

Add a `## Troubleshooting` section to `README.md` covering at minimum:

1. **"My styles got purged."** Cause: class not tied to an imported component, or built dynamically. Fix: `safelist` (see prompt 02) / verify the component is actually imported. Mention `debug` (prompt 06) if implemented.
2. **"Wrong import path / module not found after upgrading Carbon."** Cause: index/version drift (see prompt 01). Fix: align versions or upgrade the library; mention the drift warning if implemented.
3. **"`optimizeImports` breaks on my TS syntax."** Cause: ordering — `vitePreprocess()` / TS transpile must run *before* `optimizeImports()`. Show the correct `preprocess: [...]` order.
4. **"`optimizeCss` did nothing in dev."** By design: it's `apply: "build"`, production-only (and conditional for Rollup/Webpack).

Each entry: symptom → cause → fix, kept tight.

## Code example

```md
### `optimizeImports` errors on TypeScript syntax

Preprocessors run in order. Transpile TS **before** `optimizeImports`:

```js
preprocess: [vitePreprocess(), optimizeImports()] // ✅ correct order
```
```

## Acceptance criteria

- [ ] A `## Troubleshooting` section exists with the four entries above.
- [ ] Cross-links to `safelist` / drift-warning / `debug` where those features exist.
- [ ] Symptom → cause → fix format throughout.

## Feedback loop

Run after every change until clean:

```sh
bun lint:fix
```

> Markdown-only change — run `bun test` / `bun run typecheck` once to confirm no code was touched.
