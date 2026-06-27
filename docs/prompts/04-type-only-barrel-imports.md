# Fix: type-only barrel imports rewritten to bogus `.svelte` paths

> Optimized implementation prompt for `carbon-preprocess-svelte`.
> Priority: P2 · Type: fix · Est. effort: low

## Context

`src/preprocessors/optimize-imports.ts` rewrites named barrel imports from `carbon-components-svelte`. For names not in the index, a PascalCase fallback produces an optimistic `src/Name/Name.svelte` default import.

The existing test `tests/optimize-imports.test.ts:171` ("import type statements should be preserved") only covers a type import that is **already a direct path** — it does not cover a type-only import from the *barrel*.

## Problem

A type-only barrel import like:

```ts
import type { ButtonProps } from "carbon-components-svelte";
```

hits the PascalCase fallback and becomes:

```ts
import ButtonProps from "carbon-components-svelte/src/ButtonProps/ButtonProps.svelte";
```

This is wrong twice over: it **drops the `type` keyword** (turning a type import into a value import) and points at a `.svelte` file that does not exist → build error.

Mixed imports are also affected: `import Button, { type ButtonProps }` must keep the type specifier on the barrel while rewriting the value import.

## Task

1. In `rewriteImport`, detect type-only imports and type-only specifiers:
   - Whole-statement: `node.importKind === "type"`.
   - Per-specifier: `specifier.importKind === "type"` (TS allows `import { type X, Y }`).
2. For a type-only **statement**, leave it entirely untouched.
3. For type-only **specifiers** inside a mixed statement, preserve them on the barrel (the existing `preserved`/mixed-import branch already re-emits a barrel import — extend it to retain the `type` modifier) while still rewriting value specifiers.
4. Add tests for: type-only barrel statement (untouched), and mixed value + `type` specifiers.

## Code example

```ts
// input
import type { ButtonProps } from "carbon-components-svelte";
import { Button, type ButtonSize } from "carbon-components-svelte";

// expected output
import type { ButtonProps } from "carbon-components-svelte";
import Button from "carbon-components-svelte/src/Button/Button.svelte";
import { type ButtonSize } from "carbon-components-svelte";
```

## Acceptance criteria

- [ ] Type-only barrel statements are passed through unchanged.
- [ ] Type-only specifiers in a mixed statement stay on the barrel with the `type` keyword intact.
- [ ] Value specifiers in the same statement are still rewritten to source paths.
- [ ] New tests cover both cases; existing tests remain green.

## Feedback loop

Run after every change until clean:

```sh
bun lint:fix
bun test
bun run typecheck
```
