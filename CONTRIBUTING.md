# Contributing

`carbon-preprocess-svelte` ships Svelte preprocessors and build plugins that make [Carbon Design System](https://github.com/carbon-design-system/carbon-components-svelte) apps smaller and faster. Two separate problems:

- **`optimizeImports`**, a Svelte _script_ preprocessor that rewrites barrel imports (`import { Button } from "carbon-components-svelte"`) into direct path imports (`import Button from "carbon-components-svelte/src/Button/Button.svelte"`) so bundlers tree-shake and HMR stays fast.
- **`optimizeCss` / `OptimizeCssPlugin`**, build plugins (Vite/Rollup and Webpack/Rspack) that strip unused Carbon CSS rules from production output.

Option shapes, usage per bundler, and what each export does are in [README.md](README.md). That file is the source of truth for what the package supports. This file is how the code is built and changed.

If you're not sure what to build or how to approach a change, [file an issue](https://github.com/carbon-design-system/carbon-preprocess-svelte/issues) before opening a PR.

## Prerequisites

[Bun](https://bun.sh/) is the package manager, test runner, and bundler. There is no separate Node toolchain for development. Run package scripts with `bun run <script>` and one-off binaries with `bunx <bin>`.

The package has no runtime dependencies. Everything it needs (`postcss`, `magic-string`, `estree-walker`, …) is bundled into `dist/` at build time, which is why those packages sit in `devDependencies`. The one thing that is neither bundled nor declared is `svelte/compiler`: the component index parses Carbon's source with it, so [`src/indexer/svelte-parser.ts`](src/indexer/svelte-parser.ts) loads it through a dynamic `import()` that runs only when an index is actually built, resolved from the consuming project first and this package's install location second. `scripts/build.ts` fails the build if a static `from "svelte…"` import ever lands in `dist/`. `carbon-components-svelte` is _also_ a `devDependency`, for tests and benchmarks; the published package reads the consumer's install instead.

## Project set-up

Fork the repo and clone your fork:

```sh
git clone <YOUR_FORK>
cd carbon-preprocess-svelte
```

Set the original repository as the upstream:

```sh
git remote add upstream git@github.com:carbon-design-system/carbon-preprocess-svelte.git
# verify that the upstream is added
git remote -v
```

Install dependencies:

```sh
bun install
```

## Scripts

| Script | What it does |
| --- | --- |
| `bun run test` | Unit + fixture snapshot tests (`bun test --parallel`), after clearing the component index cache in `node_modules/.cache` (it's keyed by package versions, so it would otherwise hide local indexer changes; `test:e2e` clears each example's too). |
| `bun run build` | Bundle `src/index.ts` and `src/cli.ts` to `dist/`, emit `.d.ts`, write a publish-ready `dist/package.json`. Add `-w` for watch mode. |
| `bun run typecheck` | `tsc --noEmit` over `bench/`, `scripts/`, `src/`, `tests/`. |
| `bun run test:e2e` | Link the package into every `examples/*` project, build each, snapshot CSS reduction. |
| `bun run test:e2e:update` | Same, but rewrite [`tests/__snapshots__/e2e.json`](tests/__snapshots__/e2e.json). |
| `bun run test:fixtures:update` | Rewrite the `optimize-css` fixture baselines under [`tests/fixtures/`](tests/fixtures/optimize-css). |
| `bun run lint` | `biome ci --error-on-warnings` (lint + format check, no write). |
| `bun run lint:fix` | `biome check --write --unsafe .` (lint + format + organize imports). |
| `bun run upgrade-examples` | `bun update` inside each `examples/*` project. |

Scope test and lint runs to what you touched (`bun test optimize-imports`, `bunx biome check --write src/plugins`). The full e2e suite is slow because it builds seven real apps.

## How it works

The package has two entry points, exported from [`src/index.ts`](src/index.ts):

```ts
export { default as OptimizeCssPlugin } from "./plugins/OptimizeCssPlugin"; // Webpack/Rspack
export { optimizeCarbonCss } from "./plugins/optimize-carbon-css";          // Bundler-agnostic
export { optimizeCss } from "./plugins/optimize-css";                       // Vite/Rollup
export { optimizeImports } from "./preprocessors/optimize-imports";         // Svelte preprocessor
```

The CSS paths lean on the **component index**, and everything leans on the helpers in [`src/constants.ts`](src/constants.ts) / [`src/utils.ts`](src/utils.ts) (`isSvelteFile`, `isCssFile`, `isCarbonSvelteImport`, the `CarbonSvelte` package-name map, the `bx--` prefix regex).

### The component index

The CSS tools prune against a map from each public Carbon component name to its source path and the `.bx--*` classes it renders:

```ts
type ComponentIndex = Record<string, { path: string; classes: string[]; variants?: ClassVariant[] }>;
// index.Button = { path: "carbon-components-svelte/src/Button/Button.svelte", classes: [".bx--btn", ".bx--btn--", …],
//   variants: [{ prefix: ".bx--btn--", prop: "kind", default: "primary" }, …] }
```

Nothing is checked in or shipped: the index is built at build time from *the consuming project's* installed `carbon-components-svelte`, so it always matches the installed version (#213 was an older install pruned against an index built from a newer one). [`src/indexer/build-index.ts`](src/indexer/build-index.ts) exports `buildComponentIndex()`, the core:

1. Parse `src/index.js` (the barrel) to learn which names are public and how they re-export.
2. List every `.svelte`/`.js` under `src/` ([`list-files.ts`](src/indexer/list-files.ts), a sorted Node-native walk), parsing markup with `svelte/compiler` + `estree-walker` to pull static classes, sub-components, slot wrappers, and imports.
3. Run three extractors. Each one gates what it adds so the index stays tight:
   - [`extract-selectors.ts`](src/indexer/extract-selectors.ts) pulls static `class` attributes and `:global(...)` selectors from markup.
   - [`extract-runtime-classes.ts`](src/indexer/extract-runtime-classes.ts) follows the module import graph from each component: `classList.add/remove/toggle("bx--…")` calls and module-script (`context="module"` / `module`) class literals in `.svelte` modules, and every `bx--` class a `.js` module applies (hoisted constants, class prefixes). So a component that imports a constant hoisted into another component's module script gets its classes without rendering that component. The walk follows all of an imported module's imports, so it can over-include; that only keeps extra rules. Lookup selectors in `.js` (`closest(".bx--modal")`) are skipped, since a shared utility would otherwise hand the looked-up component's classes to every importer.
   - [`extract-css-context.ts`](src/indexer/extract-css-context.ts) cross-references Carbon's compiled CSS to recover context/descendant classes. `LAYOUT_ANCESTOR_DENYLIST` stops layout ancestors from spreading too far. Shares selector parsing with [`css-selector-utils.ts`](src/indexer/css-selector-utils.ts).
4. [`merge-sub-component-classes.ts`](src/indexer/merge-sub-component-classes.ts) propagates each sub-component's classes up into every ancestor that renders it. This runs to a **fixed point** (repeated passes until nothing changes, capped at 10) rather than a single pass: a parent may need classes from a child that hasn't itself absorbed its own children yet, and the propagation must land on both exported and internal (non-exported) components as merge targets. A single-pass version of this shipped for a while and was scan-order-dependent — see [#143](https://github.com/carbon-design-system/carbon-preprocess-svelte/pull/143) if you're touching this again.
5. **Variants.** `extract-selectors.ts` also records class prefixes a component completes with exactly one prop (`` `bx--btn--${kind}` `` with `export let kind = "primary"`), when the prop has a string literal default, is never reassigned, rebound, or shadowed, and no other literal in the file names the prefix. `build-index.ts` keeps a variant only if no child, runtime module, or CSS-context addition also contributes the prefix, and every Carbon module importing the component renders it as `<Component>` (so parents absorb the full prefix through the merge above). The prefix stays in `classes`; `variants` just says which entries the plugins may narrow.

   **Gates** are the same idea for exact classes: a class the component renders only under a condition on its own props (`class:x={prop}`, `class:x={prop === "v"}`, `prop && "x"`, `prop === "v" ? "x" : …`, `&&` chains). Each `&&` operand that is a bare prop or a `===`/`==` comparison with a literal becomes a `GateCondition`; other operands (state, context, `!prop`) are dropped, which is sound for `&&`. `when` is an OR over every place the class is rendered, and any unconditional (or non-prop) place makes the class ungated. Props need a literal default (string, boolean, or none) and the same no-rebinding rules as variants. Gates are vetted like variants.

Since every consumer runs this code against whatever Carbon release they have installed, a gate that only holds for the latest release is a bug. [`tests/build-index-version-compat.test.ts`](tests/build-index-version-compat.test.ts) runs the real indexer against a real, `npm:`-aliased pin of an older release (`carbon-components-svelte-old` in `devDependencies`). `buildComponentIndex()` and `resolveCarbonCssPath()` both take an explicit `carbonRoot` for this reason: an injected root (a test fixture, an old-version pin) has to reach the CSS-derived half of the index too, not just the markup half.

[`src/indexer/load-index.ts`](src/indexer/load-index.ts) is what the entry points call. `loadComponentIndex(projectRoot)` resolves `carbon-components-svelte` from the project root (Vite `root`, webpack/Rspack `context`, `optimizeCarbonCss`'s `cwd`, the CLI's `--cwd`) via [`resolve-carbon-root.ts`](src/indexer/resolve-carbon-root.ts), which searches from the project first and this package's own install location second, so a hoisted monorepo install still finds the app's Carbon. It uses `require.resolve.paths()` rather than a package.json subpath because Carbon's `exports` map doesn't declare `./package.json`, so a direct `require.resolve` throws under strict Node ESM even though it works under Bun. The result is:

- cached in the project at `node_modules/.cache/carbon-preprocess-svelte/<carbon-version>_<preprocessor-version>.json`, keyed by both versions so a bump on either side rebuilds, structurally validated on read (a parsed-but-wrong file is rebuilt, never served), and written atomically via temp file + rename;
- memoized per project root for the life of the process, so every plugin instance in a build shares one indexing pass;
- `undefined` on any failure, after one warning. Every CSS entry point then leaves Carbon CSS unpruned: a bigger stylesheet is safe, while pruning against a guess drops rules the installed markup still uses.

The index is passed explicitly to the optimizer (`createCssOptimizer({ components, … })`); there is no process-wide "active index". [`tests/load-index.test.ts`](tests/load-index.test.ts) exercises caching and failure against a throwaway project dir (see [`tests/helpers/fake-project.ts`](tests/helpers/fake-project.ts)), and [`tests/helpers/component-index.ts`](tests/helpers/component-index.ts) builds the index the other tests prune against from the `carbon-components-svelte` devDependency.

Pass `onTiming` to `buildComponentIndex()` (as [`bench/build-index.bench.ts`](bench/build-index.bench.ts) does) for per-stage timings.

### `optimizeImports`

[`src/preprocessors/optimize-imports.ts`](src/preprocessors/optimize-imports.ts) is a Svelte `script` preprocessor. Per file:

- **Fast path.** Bail immediately on `node_modules` files and on any file whose raw source does not contain the substring `"carbon-"`. That skips the parse for almost every file. Do not remove this when changing the module.
- The Svelte compiler's `parse()` wants a whole component, so the raw script is wrapped in `<script lang="ts">…</script>`, parsed, walked for `ImportDeclaration`s, rewritten with `MagicString`, then the wrapper tags are stripped back off.
- Carbon component names resolve through the installed `carbon-components-svelte`'s own barrel. [`carbon-exports.ts`](src/preprocessors/carbon-exports.ts) reads `src/index.js` synchronously (once per preprocessor instance, and only once a file actually imports from `carbon-components-svelte`) and follows each re-export to the module that defines it: older releases hop through a folder `index.js`, newer ones point straight at the `.svelte` file. A default export becomes `import X from "…"`; a named export stays named (`import { toCsv } from "…/data-table-utils.js"`), since rewriting it to a default import would bind the wrong value or none. Names the barrel doesn't export stay on the barrel. Icons and pictograms map to `lib/Name.svelte`.
- **Type imports stay on the barrel.** `import type { … }` statements are left alone. In `import { type X, Y }`, `X` stays on the barrel and only `Y` is rewritten. Recent fixes ([#138](https://github.com/carbon-design-system/carbon-preprocess-svelte/pull/138), [#133](https://github.com/carbon-design-system/carbon-preprocess-svelte/pull/133)) live here. Add a fixture in [`tests/optimize-imports.test.ts`](tests/optimize-imports.test.ts) for any import-shape change.

### `optimizeCss` (Vite/Rollup) and `OptimizeCssPlugin` (Webpack/Rspack)

Both plugins do the same job through different bundler hooks, then call the same optimizer.

- [`src/plugins/optimize-css.ts`](src/plugins/optimize-css.ts) is the Vite plugin (`apply: "build"`, `enforce: "post"`). It collects Carbon component ids in the `transform` hook, then rewrites CSS assets in `generateBundle` by mutating `file.source` in place. The scanner is synchronous.
- [`src/plugins/OptimizeCssPlugin.ts`](src/plugins/OptimizeCssPlugin.ts) is the Webpack plugin, production-only. It collects ids by reading each module's `resource` in the `finishModules` hook (fires once the whole module graph has resolved, so every Carbon Svelte component already exists as its own module), then processes CSS assets at `PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE` (before minification). All assets are scanned in parallel via `Promise.all`. It is typed against a minimal structural subset of the `Compiler`/`Compilation` API (not imported from the `webpack` package) so the same plugin instance also works unchanged with Rspack, which implements that same `compiler.webpack` namespace for plugin compatibility but does not implement webpack's `NormalModule.getCompilationHooks().beforeSnapshot` hook that an earlier version of this plugin relied on.

Unless `scanModules: false`, both plugins also run [`scan-props.ts`](src/plugins/scan-props.ts) over every bundled module except stylesheets and Carbon's own `src/` (resolved from the project, symlinks followed). That is wider than the `bx--` token scan on purpose: this scan fails open, so a module it skips could hold the only literal for a variant and get it dropped. A path that merely contains `carbon-components-svelte` (Carbon's docs site, a fork) and virtual modules are read; a module whose source throws, or a scan that throws, marks every prop dynamic. So does any external import other than a Node built-in (the code never enters the build): Rollup flags those `isExternal`, Rolldown only leaves their `code` `null`, and webpack/Rspack list them as `ExternalModule`s (`externalType`). SSR builds that leave dependencies to Node, like Astro's, never narrow for this reason. It records the literal values passed to every variant prop the index names (`kind: "ghost"` in compiled Svelte, `kind="ghost"` in markup), or marks the prop dynamic on any use it can't read as a literal. Framework runtimes (`svelte`, `@sveltejs/kit`, `astro`, `devalue`, `vite` under `node_modules`) are skipped too: they forward props but never originate one, and they name `type`, `size`, `open`, … in their own code. A quoted name counts only as a key (`"kind": …`, `["kind"] = …`); `kind: "danger"` is a value, not a mention of Modal's `danger` prop. `buildUsage` then expands a variant prefix to `prefix + default` plus `prefix + literal`, unless the prop is dynamic or another bundled component contributes the prefix whole, and leaves out a gated class no condition can reach (`canHold`: dynamic, or the default or a literal satisfies it; any literal counts as truthy). Gated-off classes that nothing else keeps become `denied`, which `strict-css-optimizer.ts` checks before its BEM-parent inference, so `.bx--tag` on the allowlist no longer implies `.bx--tag--filter`. An exact entry or a contributed hyphen prefix still wins over `denied`. The webpack plugin loads the index in `finishModules` (via `tapPromise`) for this, since it needs the prop names before scanning. The Vite plugin keeps the scan per module id, like `ids` and `moduleClasses`, and drops ids that left `this.getModuleIds()` at `generateBundle`. `optimizeCarbonCss` and the CLI pass no prop usage, so they never narrow.

Unless `scanModules: false`, both plugins also scan the code of every bundled module (`transform` for Vite, `module.originalSource()` in `finishModules` for Webpack/Rspack) for literal `bx--` tokens, so hand-written classes in app markup survive without `content`/`safelist`. The scan itself, `collectCarbonTokens()`, lives in [`src/plugins/scan-content.ts`](src/plugins/scan-content.ts) and is shared with the `content` glob scan (`scanContent`). Stylesheet modules of any flavor are never scanned (`isScannableModule`): a `.scss` entry that `@import`s Carbon's theme reaches `transform` as compiled CSS and would allowlist everything.

The shared core is [`src/plugins/create-optimized-css.ts`](src/plugins/create-optimized-css.ts). It builds an **allowlist** of `.bx--*` classes from the bundled components' index entries, plus `ALWAYS_ON_CLASSES` and any `content`/module-scanned tokens, then runs the splice scanner in [`css-splice-optimizer.ts`](src/plugins/css-splice-optimizer.ts). It exposes sync (`optimizeCssWithReport`) and async (`…Async`) variants because Vite and Webpack differ. Keep the two in lockstep when you change behavior. The `report.removed` count suppresses the size-diff log when nothing was pruned ([#131](https://github.com/carbon-design-system/carbon-preprocess-svelte/pull/131)). `optimizeCarbonCss` in [`src/plugins/optimize-carbon-css.ts`](src/plugins/optimize-carbon-css.ts) is the bundler-agnostic wrapper over the same core.

Pruning is implemented in [`src/plugins/strict-css-optimizer.ts`](src/plugins/strict-css-optimizer.ts) (the module name predates graduating this to the only/default matcher; there is no other mode to switch on). It prunes individual selectors out of comma lists. Every Carbon class in a same-element compound must match. Descendant selectors split into ancestors + subject (subject must fully match; ancestors may match `CONTEXT_ANCESTORS` without being imported). Strips `:not(...)` before matching. Drops flatpickr/legacy `bx-` rules unless DatePicker is bundled. Parenthesis-aware for `:is()`. Most CSS-correctness work happens here.

Supporting modules: [`safelist.ts`](src/plugins/safelist.ts) (string = literal class-token match, RegExp = whole-selector match), [`scan-content.ts`](src/plugins/scan-content.ts) (glob source files for literal `bx--` tokens, for runtime-built class names like `` `bx--btn--${kind}` ``), [`print-diff.ts`](src/plugins/print-diff.ts) (the before/after size log the e2e tests parse; under Vite the same block is emitted through `config.logger.info` as one string (`formatDiff`), everywhere else through `console.log` (`printDiff`) — both must stay byte-identical). Safelist and `content` are the user-facing overrides added in [#140](https://github.com/carbon-design-system/carbon-preprocess-svelte/pull/140).

## Conventions

Biome enforces most of this in CI (`bun run lint`). Config: [`biome.json`](biome.json), space indent, multiline attributes, imports auto-organized. The recommended preset is on by default. Extra rules in `biome.json` are errors. Warnings also fail CI.

- **Hoist regexes to module scope.** `useTopLevelRegex` is an error. A regex literal inside a function fails lint. Declare it as a named top-level `const` (see the `*_REGEX` / `CARBON_*` constants at the top of nearly every module).
- **No `await` in loops, no `forEach`.** `noAwaitInLoops` and `noForEach` are errors. Build the work and `await Promise.all(...)`, or use `for...of` with hoisted awaits. The two intentional sequential-await loops in [`tests/test-e2e.ts`](tests/test-e2e.ts) carry `// biome-ignore` comments explaining why. Match that pattern if you genuinely need ordering.
- **No namespace imports, no barrel re-exports, no import cycles.** `noNamespaceImport`, `noReExportAll`, `noImportCycles`. Export named bindings explicitly, as [`src/index.ts`](src/index.ts) does.
- **No `delete`, no accumulating spread, prefer arrow functions and literal keys.** `noDelete`, `noAccumulatingSpread`, `useArrowFunction`, `useLiteralKeys`.
- **No `!important` in authored styles** (`noImportantStyles`) and **no `bun:test` imports**. The Bun test globals (`describe`, `test`, `expect`) are ambient. Importing them is an error.
- **Use `node:` import specifiers**, e.g. `import path from "node:path"`, as the scripts and plugins do. `useNodejsImportProtocol` is an error.
- **No `enum`, no `@ts-ignore`, no `any`.** `noEnum`, `noTsIgnore`, `noExplicitAny`. Use `@ts-expect-error` when a test must suppress a type error. Use `import type` / `export type` (`useImportType`, `useExportType`).
- **No focused or skipped tests.** `noFocusedTests` and `noSkippedTests`. Do not land `.only` or `.skip`.

TypeScript ([`tsconfig.json`](tsconfig.json)) is check-only (`noEmit`). JS and `.d.ts` come from [`scripts/build.ts`](scripts/build.ts) and [`scripts/bundle-dts.ts`](scripts/bundle-dts.ts). It runs `strict` with `noUnusedLocals`, `noUnusedParameters`, and `erasableSyntaxOnly` (no runtime-emitting TS syntax: enums, parameter properties, etc.). The `carbon-preprocess-svelte` path alias resolves to `src/` so tests import the package by name.

Comment the _why_ behind non-obvious parser, hook-ordering, and CSS-matching logic. The existing modules are heavily annotated; match that density. Skip comments that restate the code.

## Testing

Tests use the Bun test runner and live in [`tests/`](tests), mostly one `*.test.ts` per `src/` module.

```sh
bun run test                       # everything, in parallel
bun test optimize-imports          # filter by file-path substring
bun test tests/utils.test.ts       # a single file
bun test --watch                   # watch mode
```

Three layers, smallest to largest:

### Unit tests

Per-module behavior: [`utils.test.ts`](tests/utils.test.ts), [`scan-content.test.ts`](tests/scan-content.test.ts), [`print-diff.test.ts`](tests/print-diff.test.ts), [`extract-selectors.test.ts`](tests/extract-selectors.test.ts), [`optimize-imports.test.ts`](tests/optimize-imports.test.ts), [`create-optimized-css.test.ts`](tests/create-optimized-css.test.ts), [`OptimizeCssPlugin.test.ts`](tests/OptimizeCssPlugin.test.ts). Add a focused case here for any logic change.

### CSS optimization fixtures

[`tests/optimize-css-fixtures.test.ts`](tests/optimize-css-fixtures.test.ts) is the main regression check for the optimizer. It runs `createOptimizedCss` against Carbon's compiled stylesheet (`carbon-components-svelte/css/white.css`) for ~35 scenarios. Each scenario is a set of imported component ids in default or strict mode. Output is compared to committed baselines under [`tests/fixtures/optimize-css/`](tests/fixtures/optimize-css).

Each scenario has two files:

- `<name>.css`, the pruned, pretty-printed output. **Gitignored**, regenerated every run. Open it to see what survived.
- `<name>.report.json`, the **committed** baseline: `reduction_percent`, `kept_rules`, byte counts, and `leaked_classes` (Carbon classes still present that the import allowlist cannot explain). Strict scenarios target `leaked_count: 0`.

Beyond byte baselines, the test also checks the index: no over-prune (a selector that should survive keeps its classes), no foreign survivor in strict mode, correct multi-class strict pruning. See [`tests/fixtures/optimize-css/README.md`](tests/fixtures/optimize-css/README.md) for the scenario catalog and when to add a fixture (extractor gate change, new typical multi-import bundle, suspected leak/over-prune regression, not a duplicate import set).

After an optimizer change or a Carbon bump, regenerate and **review the `.report.json` diff**. A baseline change is a behavior change:

```sh
bun run test:fixtures:update
```

Shared helpers (`buildAllowlist`, `matchesAllowlist`, `shouldKeepStrictSelector`, `resolveCarbonCss`, `prettifyCss`) live in [`tests/helpers/carbon-css.ts`](tests/helpers/carbon-css.ts). They mirror production matching logic so the test can re-derive what the optimizer should have done.

### End-to-end tests

[`tests/test-e2e.ts`](tests/test-e2e.ts) (`bun run test:e2e`) builds the package, `bun link`s it into each project under [`examples/`](examples), builds every example, parses the `printDiff` output, and compares CSS reduction to [`tests/__snapshots__/e2e.json`](tests/__snapshots__/e2e.json) within 0.01 tolerance. Unit tests will not catch a plugin that silently no-ops inside a real Vite, Webpack, or Rspack build. This suite will — it's how the `finishModules`/`resource` rewrite of `OptimizeCssPlugin` was validated against real Webpack and Rspack builds, since the unit test mock alone could not have caught the timing bug where `buildInfo.fileDependencies` isn't populated yet at `finishModules`.

The examples are real downstream consumers, each linking the package via `"carbon-preprocess-svelte": "link:carbon-preprocess-svelte"`:

- `examples/rollup`, `examples/rolldown`, `examples/vite`, `examples/vite@svelte-5`, `examples/sveltekit`, `examples/astro`: Vite/Rollup plugin path
- `examples/webpack`, `examples/webpack@svelte-5`: Webpack plugin path
- `examples/rspack`: Rspack plugin path, using the same `OptimizeCssPlugin` export as Webpack

Other Svelte frameworks (Routify, …) run Vite under the hood, so the Vite examples cover them. When you change output shape or reduction behavior, update snapshots and read the diff:

```sh
bun run test:e2e:update
```

`bun run upgrade-examples` bumps each example's dependencies.

## Build

[`scripts/build.ts`](scripts/build.ts) (`bun run build`) removes `dist/`, copies `README.md` and `LICENSE` into it (before anything generated lands there, so a failed build never leaves a half-written manifest next to missing assets), bundles two entry points, `src/index.ts` (the library) and `src/cli.ts` (the `optimize-css` CLI), with `Bun.build` (minified ESM, Node target, `splitting: true` so the code shared between them, the indexer and the CSS optimizer, is emitted once as a `chunk-*.js` instead of duplicated into both bundles), then runs [`scripts/bundle-dts.ts`](scripts/bundle-dts.ts) to emit `dist/index.d.ts` (the CLI exports no types, so it's skipped there). Rather than mirroring every `src` module into `dist/` (`tsc`'s default behavior), `bundle-dts.ts` uses the TypeScript compiler API (via `@typescript/typescript6`, since TypeScript 7's `typescript` package no longer ships it) to inline only the declarations reachable from `src/index.ts`'s public exports into a single tree-shaken file. After the bundle step, `dist/cli.js` gets a `#!/usr/bin/env node` shebang and is `chmod`ed executable (Bun's build strips shebangs), and the static-`svelte`-import guard runs over every emitted `.js` file under `dist/`, not just `index.js`, since splitting can move code into a shared chunk. Finally the build writes `dist/package.json`: a copy of the root manifest with `devDependencies`, `scripts`, and `files` stripped, and `main`/`types`/`bin`/`exports` rewritten from `./dist/*` to `./*` so paths resolve once `dist/` is published as the tarball root. `dist/` is gitignored and never committed. `bun run build -w` rebuilds on changes under `src/` and keeps linked examples current.

## Continuous integration

[`.github/workflows/test.yml`](.github/workflows/test.yml) runs on every PR and on pushes to `main` (macOS runner):

1. `bun ci`
2. `bun run lint`
3. `bun run typecheck`
4. `bun run test`
5. `bun run test:e2e`

Run those locally before pushing. The e2e suite runs in CI, so a snapshot you forgot to update will fail the build.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>
```

- Common types: `fix`, `feat`, `perf`, `chore`, `test`, `docs`, `refactor`.
- Scope is the area touched: `optimize-css`, `optimize-imports`, `index`, `examples`, `e2e`, `deps-dev`, `ci`.
- Imperative mood, one concise line. Put detail in the body and reference issues with `Fixes #N`.

Examples from the log:

```
feat(optimize-css): add safelist and content escape hatches
perf(optimize-imports): skip parse for files without carbon- imports
fix(index): automate runtime and CSS context classes
```

## Submit a pull request

Sync your fork with upstream first:

```sh
git fetch upstream
git checkout main
git merge upstream/main
```

Push your branch and open a PR comparing your feature branch to `origin/main`. Keep PRs focused. Include regenerated artifacts your change needs: fixture baselines and e2e snapshots. Those diffs are part of the review.

## Maintainer guide

The following applies only to maintainers.

### Release

[`.github/workflows/release.yml`](.github/workflows/release.yml) publishes to NPM with [provenance](https://docs.npmjs.com/generating-provenance-statements) when a tag starting with `v` is pushed. It installs, runs `bun run build`, then `npm publish --provenance --access public` from `dist/`.

To cut a release:

1. Bump `version` in [`package.json`](package.json) and update [`CHANGELOG.md`](CHANGELOG.md).
2. Commit with the version as the message, tag, and push the tag:

```sh
git commit -am "v0.11.37"
git tag v0.11.37
git push origin v0.11.37
```

A successful workflow publishes the new version to NPM.

### Post-release

1. Create a [new release](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/new) on GitHub and publish it as the latest release.
2. Close out any issues resolved in the release.
