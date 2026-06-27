# Fast-path `optimizeImports` to skip parsing non-Carbon files

> Optimized implementation prompt for `carbon-preprocess-svelte`.
> Priority: P1 · Type: performance · Est. effort: low

## Context

`src/preprocessors/optimize-imports.ts` runs on **every** `.svelte` file's `<script>` on every build and every HMR update. For each file it currently:

1. wraps the raw script in `<script lang="ts">…</script>`,
2. allocates a `MagicString`,
3. runs `svelte/compiler` `parse()`,
4. walks the full AST looking for `ImportDeclaration`s.

## Problem

In a real app the overwhelming majority of `.svelte` files import **no Carbon packages** at all, yet they still pay for the wrap + parse + walk. This is wasted work in exactly the hot path the preprocessor exists to optimize.

## Task

1. Add a cheap substring guard at the top of the `script` hook, before any allocation/parse. The only import sources that can ever be rewritten are the three in `src/constants.ts` (`CarbonSvelte.Components/Icons/Pictograms`), all of which share the `carbon-` prefix:
   ```ts
   if (!raw.includes("carbon-")) return;
   ```
2. Keep the existing `node_modules` / missing-filename guards.
3. Confirm the early return preserves behavior: returning `undefined` from a preprocessor leaves the file untouched (same as today when there are no rewrites).
4. Add a test asserting a file with no `carbon-` substring is returned untouched and that a file importing Carbon still gets rewritten.

## Code example

```diff
  script({ filename, content: raw }) {
    if (!filename) return;
    if (NODE_MODULES_REGEX.test(filename)) return;
+
+   // Fast path: the only rewritable import sources contain "carbon-".
+   // Skip MagicString + svelte parse for the common no-Carbon file.
+   if (!raw.includes("carbon-")) return;

    const content = `<script lang="ts">${raw}</script>`;
    const s = new MagicString(content);
```

## Acceptance criteria

- [ ] Files without a `carbon-` substring skip `parse()` entirely (verify via test or a temporary spy).
- [ ] Existing `optimize-imports.test.ts` cases still pass unchanged.
- [ ] A new test covers the early-return (untouched output) case.

## Feedback loop

Run after every change until clean:

```sh
bun lint:fix
bun test
bun run typecheck
```
