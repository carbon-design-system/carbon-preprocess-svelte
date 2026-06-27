# Docs: "Which export do I need?" decision guide

> Optimized implementation prompt for `carbon-preprocess-svelte`.
> Priority: P3 · Type: docs · Est. effort: low

## Context

`README.md` documents three exports (`optimizeImports`, `optimizeCss`, `OptimizeCssPlugin`) and, in a `> [!NOTE]`, concedes that `@sveltejs/vite-plugin-svelte` now enables `prebundleSvelteLibraries: true` by default — which covers much of the original reason `optimizeImports` existed.

## Problem

The value proposition for each export — and *whether a Vite user even needs `optimizeImports`* — is buried in prose and a note. New users can't quickly tell which tool to reach for given their bundler and whether they're in dev or build.

## Task

1. Add a short decision matrix near the top of the Usage section mapping **bundler × phase → recommended export**. Example axes: Vite, Rollup, Webpack × dev, production build.
2. State plainly when `optimizeImports` is redundant (Vite + `prebundleSvelteLibraries: true`) and when it still helps (Rollup/Webpack, or further cold-start gains).
3. Cross-link each row to the existing per-bundler setup subsections.
4. Keep it scannable — a table plus 2–3 sentences, not a new essay.

## Code example

```md
| Bundler | Dev server                    | Production build            |
| ------- | ----------------------------- | --------------------------- |
| Vite    | `prebundleSvelteLibraries` ✓  | `optimizeCss`               |
| Rollup  | `optimizeImports`             | `optimizeImports` + `optimizeCss` |
| Webpack | `optimizeImports`             | `optimizeImports` + `OptimizeCssPlugin` |
```

## Acceptance criteria

- [ ] A matrix exists near the top of Usage and is internally consistent with the per-bundler sections.
- [ ] The "do I need `optimizeImports`?" question is answered explicitly.
- [ ] Links resolve to existing anchors.

## Feedback loop

Run after every change until clean:

```sh
bun lint:fix
```

> Markdown-only change — `bun test` / `bun run typecheck` should remain green and untouched; run them once to confirm no accidental code edits.
