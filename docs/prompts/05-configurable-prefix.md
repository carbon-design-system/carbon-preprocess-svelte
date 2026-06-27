# Make the Carbon class prefix configurable

> Optimized implementation prompt for `carbon-preprocess-svelte`.
> Priority: P2 · Type: feature · Est. effort: low-medium

## Context

The `bx--` class prefix is hardcoded throughout `src/constants.ts`:

- `CARBON_PREFIX = /bx--/`
- `ALWAYS_ON_CLASSES = [".bx--body"]`
- `CONTEXT_ANCESTORS = [".bx--body--with-modal-open", ".bx--header__global", …]`

It is consumed in `src/plugins/create-optimized-css.ts` and `src/plugins/strict-css-optimizer.ts`.

## Problem

If Carbon's prefix changes in a future release, or a consumer customizes it, the CSS optimizer silently mis-behaves: with the wrong prefix `CARBON_PREFIX` never matches, so the plugin no-ops (no pruning), or — worse in strict mode — prunes incorrectly. There is no way to adjust it.

## Task

1. Add a `prefix` option to `OptimizeCssOptions` (default `"bx--"`).
2. Derive the prefix-dependent values from it instead of importing hardcoded constants:
   - the `CARBON_PREFIX` regex,
   - `ALWAYS_ON_CLASSES` (e.g. `.${prefix}body`),
   - `CONTEXT_ANCESTORS`.
   Thread the computed values through `buildUsage`, `shouldKeepRule`, and the strict matchers rather than importing module-level constants.
3. Keep `bx--` as the default so existing behavior is byte-for-byte identical (verify against current fixtures).
4. Document the option in `README.md`.

## Code example

```ts
optimizeCss({
  prefix: "bx--", // default; override only if your Carbon build uses a different prefix
});
```

```diff
- import { ALWAYS_ON_CLASSES, CARBON_PREFIX } from "../constants";
+ const { carbonPrefix, alwaysOnClasses, contextAncestors } =
+   resolvePrefixConfig(options?.prefix);
```

## Acceptance criteria

- [ ] Default behavior (`bx--`) is unchanged — all existing fixtures/snapshots pass without regeneration.
- [ ] A custom prefix is honored end-to-end (a fixture using a different prefix prunes correctly).
- [ ] No prefix string is hardcoded in the matcher paths after refactor.

## Feedback loop

Run after every change until clean:

```sh
bun lint:fix
bun test
bun run typecheck
```
