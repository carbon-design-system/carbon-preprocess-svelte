# Add a `safelist` (and content-scan) escape hatch to `optimizeCss`

> Optimized implementation prompt for `carbon-preprocess-svelte`.
> Priority: P1 · Type: feature · Est. effort: medium

## Context

- `src/plugins/create-optimized-css.ts` builds the kept-class allowlist **only** from imported `.svelte` component files (`buildUsage`) plus a tiny internal `ALWAYS_ON_CLASSES` (`src/constants.ts` → `[".bx--body"]`).
- The set of tracked modules comes from `isCarbonSvelteImport` in `src/utils.ts` (`.svelte` files whose id includes `carbon-components-svelte`).

## Problem

There is **no user-facing safelist** (confirmed: no `safelist`/`allowList` option exists). This breaks two common, legitimate patterns:

1. **Hand-written Carbon classes** in app markup, e.g. `<div class="bx--grid">`, layout/theme utility classes — these are pruned because no component file references them.
2. **Dynamically constructed class names**, e.g. ``class={`bx--btn--${kind}`}`` — invisible to importer-based detection.

This is the most likely "the plugin deleted my styles" failure mode, and today the only workaround is to stop using the plugin.

## Task

1. Add a `safelist` option to `OptimizeCssOptions` in `create-optimized-css.ts`:
   ```ts
   safelist?: Array<string | RegExp>;
   ```
   Each string matches a class literally; each RegExp is tested against the selector. Thread it into `buildUsage`/`shouldKeepRule` and the strict path (`strict-css-optimizer.ts`) so a matching selector is always kept.
2. (Optional, larger) Add a `content` glob option that scans matched source files and keeps any literal `bx--`-prefixed token found. Document it as the fix for dynamic class names.
3. Document both in the `optimizeCss` API section of `README.md`, with the dynamic-class footgun called out explicitly.

## Code example

```ts
// vite.config.js
optimizeCss({
  // keep classes that are written by hand or built at runtime
  safelist: [".bx--grid", ".bx--aspect-ratio", /^\.bx--btn--/],
});
```

```diff
  // create-optimized-css.ts — buildUsage()
  const allowlist = new Set(ALWAYS_ON_CLASSES);
+ for (const entry of safelist ?? []) {
+   if (typeof entry === "string") allowlist.add(entry);
+ }
  // RegExp entries are checked in shouldKeepRule / strict matcher
```

## Acceptance criteria

- [ ] String entries keep exactly-matching selectors; RegExp entries keep matching selectors.
- [ ] Works in both default and `experimental.strict` modes.
- [ ] A fixture proves a hand-written `bx--grid` rule survives when safelisted and is pruned when not.
- [ ] README documents `safelist` and the dynamic-class caveat.

## Feedback loop

Run after every change until clean:

```sh
bun lint:fix
bun test
bun run typecheck
```

> Tip: regenerate fixtures with `bun run test:fixtures:update` and review the diff before committing.
