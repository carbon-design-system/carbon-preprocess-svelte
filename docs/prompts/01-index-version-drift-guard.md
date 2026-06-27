# Guard against component-index version drift

> Optimized implementation prompt for `carbon-preprocess-svelte`.
> Priority: P1 · Type: feature · Est. effort: medium

## Context

- `src/component-index.ts` is **generated** (`// @generated`) by `scripts/index-components.ts` against a *pinned* `carbon-components-svelte` version (currently `0.109.0`, see `package.json` `devDependencies` and the `chore(components): re-index using v0.109.0` commits).
- Both consumers of the index assume it matches the installed Carbon:
  - `src/preprocessors/optimize-imports.ts` rewrites barrel imports to source paths from `components[name].path`.
  - `src/plugins/create-optimized-css.ts` (`buildUsage`) builds the CSS allowlist from `components[name].classes`.

## Problem

When a consumer installs a different `carbon-components-svelte` version than the one the index was built against, failures are **silent**:

- `optimizeImports` can rewrite to a source path that moved/renamed → build-time module-not-found or the wrong component.
- `optimizeCss` keeps/prunes the wrong `.bx--` classes → missing or bloated styles.

There is currently no signal to the consumer that the index is stale.

## Task

1. During index generation, record the Carbon version the index was built against. Emit it as an exported constant in the generated file:
   ```ts
   // src/component-index.ts (generated)
   export const INDEXED_CARBON_VERSION = "0.109.0";
   ```
   Update `scripts/index-components.ts` to read this from the installed `carbon-components-svelte/package.json` at generation time.
2. Add a small shared helper that resolves the consumer's installed Carbon version at runtime (read `carbon-components-svelte/package.json` via its resolved path; tolerate it being absent).
3. In both `optimizeImports()` init and `optimizeCss()` init, compare versions and emit a **single, throttled** `console.warn` on mismatch (warn once per process, not per file). Example message:
   ```
   [carbon-preprocess-svelte] Index built for carbon-components-svelte@0.109.0 but 0.112.0 is installed.
   Import paths and pruned CSS classes may be inaccurate. See <docs link>.
   ```
4. Make the warning suppressible via an option (e.g. `optimizeImports({ silent: true })` / reuse `optimizeCss`'s existing `silent`).

## Code example

```ts
// proposed helper
import { INDEXED_CARBON_VERSION } from "../component-index";

let warned = false;
export function warnOnVersionDrift(silent = false) {
  if (warned || silent) return;
  const installed = resolveInstalledCarbonVersion(); // null if not found
  if (installed && installed !== INDEXED_CARBON_VERSION) {
    warned = true;
    console.warn(
      `[carbon-preprocess-svelte] Index built for carbon-components-svelte@${INDEXED_CARBON_VERSION} ` +
        `but ${installed} is installed. Import paths and pruned CSS may be inaccurate.`,
    );
  }
}
```

## Acceptance criteria

- [ ] `INDEXED_CARBON_VERSION` is emitted by the generator and committed in `src/component-index.ts`.
- [ ] Mismatch warns exactly once; match (or unresolved version) is silent.
- [ ] `silent` suppresses the warning.
- [ ] No warning is emitted when versions match (covered by a test that stubs the resolver).
- [ ] Zero new runtime dependencies (library is zero-dependency).

## Feedback loop

Run after every change until clean:

```sh
bun lint:fix
bun test
bun run typecheck
```
