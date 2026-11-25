# Contributing

`carbon-preprocess-svelte` ships Svelte preprocessors and build plugins that make [Carbon Design System](https://github.com/carbon-design-system/carbon-components-svelte) apps smaller and faster. Three separate problems:

- **`optimizeImports`**, a Svelte _script_ preprocessor that rewrites barrel imports (`import { Button } from "carbon-components-svelte"`) into direct path imports (`import Button from "carbon-components-svelte/src/Button/Button.svelte"`) so bundlers tree-shake and HMR stays fast.
- **`optimizeCss` / `OptimizeCssPlugin`**, build plugins (Vite/Rollup and Webpack/Rspack) that strip unused Carbon CSS rules from production output, including the rules for prop values the app never passes.
- **`optimizeComponents` / `OptimizeComponentsPlugin`**, build plugins that rewrite each Carbon component the app renders (and the app's own wrappers) for the props it passes, removing code that can't run. CSS pruning and these share one analysis, [svelte-prune](https://github.com/metonym/svelte-prune).

Option shapes, usage per bundler, and what each export does are in [README.md](README.md). That file is the source of truth for what the package supports. This file is how the code is built and changed.

If you're not sure what to build or how to approach a change, [file an issue](https://github.com/carbon-design-system/carbon-preprocess-svelte/issues) before opening a PR.

## Prerequisites

[Bun](https://bun.sh/) is the package manager, test runner, and bundler. There is no separate Node toolchain for development. Run package scripts with `bun run <script>` and one-off binaries with `bunx <bin>`.

The package has no runtime dependencies. Everything it needs (`caligula`, `svelte-prune`, `svelte-ast`, …) is bundled into `dist/` at build time, which is why those packages sit in `devDependencies`. `optimizeImports` and svelte-prune's analysis parse with [`svelte-ast`](https://github.com/metonym/svelte-ast), not `svelte/compiler`, so the published package never loads `svelte`: `scripts/build.ts` fails the build if anything in `dist/` imports `"svelte"` or `"svelte/…"`. It matches text, so a string in bundled code counts too: svelte-ast's error `from "svelte-ast/typescript"` is why it needs a quote or `/` right after `svelte`. `carbon-components-svelte` is _also_ a `devDependency`, for tests and benchmarks; the published package reads the consumer's install instead.

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
| `bun run test` | Unit and snapshot tests (`bun test --parallel`). |
| `bun run test:changed` | The unit tests the working tree's changes since `main` can reach, picked by [bivium](https://github.com/metonym/bivium) from [`bivium.config.ts`](bivium.config.ts). |
| `bun run build` | Bundle `src/index.ts` and `src/cli.ts` to `dist/`, emit `.d.ts`, write a publish-ready `dist/package.json`. Add `-w` for watch mode. |
| `bun run typecheck` | `bun check` (Bun's built-in type checker) over `bench/`, `scripts/`, `src/`, `tests/`. |
| `bun run typecheck:svelte` | [svelte-typecheck](https://github.com/metonym/svelte-typecheck) over the `.svelte` files in [`golden/`](golden/README.md). Warnings fail. |
| `bun run test:package` | Build and pack `dist/`, install it next to Svelte and Vite in a scratch project, load every export and the CLI in Node, and type-check a consumer of every public export with `skipLibCheck: false`, on Svelte 4 and 5. The published types import nothing: a webpack project has no Vite, and no project has the bundled packages (`svelte-ast`, `svelte-prune`), so the plugins' return type is declared here ([`bundler-plugin.ts`](src/plugins/bundler-plugin.ts)) and so is `optimizeImports`'s. The webpack consumer is checked before Vite is installed. |
| `bun run test:e2e` | Link the package into every `examples/*` project, build each, snapshot CSS reduction. |
| `bun run test:e2e:update` | Same, but rewrite [`tests/__snapshots__/e2e.json`](tests/__snapshots__/e2e.json). Set `EXAMPLES=vite,vite@svelte-5` to build (and update) only those examples. |
| `bun run snapshots:from-ci` | When a pull request changes sizes on purpose: rewrite `e2e.json` with what CI's e2e step observed for the current commit (needs `gh`), without building the examples locally. |
| `bun run lint:all` | Format with `bun fmt`, then fix what `bun lint` and svelte-lint can. CI runs `bun fmt --check`, `bun lint` and `bun run lint:svelte`, which write nothing. |
| `bun run lint:changed` | Same, on staged files only. |
| `bun run lint:svelte` | [svelte-lint](https://github.com/metonym/svelte-lint) over every `.svelte` file: the `bun lint` rules on its scripts, and the Svelte compiler's warnings on its markup. |
| `bun run upgrade-examples` | `bun update` inside each `examples/*` project. |
| `bun run eval:prop-aware` | Accuracy check for pruning by props: SSR-renders an app per Carbon component and prop value (plus random mixes), and fails if a selector matching rendered classes was pruned. `--apps <glob>` runs it on existing app files; `--control` prunes everything to prove the check catches it. |
| `bun run eval:specialize` | Accuracy and size check for component specialization (svelte-prune's `specializeComponent`): rewrites the Carbon components each app renders for its props, then requires byte-identical SSR HTML against the originals (`Math.random` seeded, hydration comments removed) and reports minified JS savings. Same `--only`/`--apps`/`--combos` flags, plus `--wrappers` (only the apps with their own wrappers and recursive components, from [`scripts/wrapper-cases.ts`](scripts/wrapper-cases.ts)), `--golden` (the apps in [`golden/`](golden/README.md)), `--unwrap`, `--project <dir>` (another install's Svelte 3, 4 or 5 and Carbon) and `--json <file>`. |
| `bun run eval:interactions` | Builds the optimized variants of the `vite-matrix`, `sveltekit-matrix`, `astro`, `rollup`, `rolldown`, `webpack`, `webpack@svelte-5` and `rspack` examples and drives each through the same clicks, typing, hovers and key presses as the unoptimized build in Chromium (Playwright), requiring identical DOM and pixels after every step. For the prerendered SvelteKit and Astro examples it also compares the prerendered HTML, console messages, and markup thrown away while hydrating. Catches what SSR can't: effects, hydration, interactive states. Needs each example installed with the package linked (see its README); `--examples a,b` runs a subset (`golden/<app>` too), and `--no-build` reuses the last builds. |

Scope test and lint runs to what you touched (`bun test optimize-imports`, `bun lint --fix src/plugins`). The full e2e suite is slow because it builds every app under [`examples/`](examples).

## How it works

The package has two entry points: the library, [`src/index.ts`](src/index.ts), and the `optimize-css` CLI, [`src/cli.ts`](src/cli.ts). The library exports:

```ts
export { type CarbonBunPlugin, optimizeCarbonBun } from "./plugins/bun";       // Bun
export { type CarbonOptimizer, type CarbonOptimizerOptions, createCarbonOptimizer } from "./plugins/carbon-optimizer"; // Bundler-agnostic
export { OptimizeComponentsPlugin } from "./plugins/OptimizeComponentsPlugin"; // Webpack/Rspack
export { OptimizeCssPlugin } from "./plugins/OptimizeCssPlugin";               // Webpack/Rspack
export { optimizeCarbonCss } from "./plugins/optimize-carbon-css";             // Bundler-agnostic
export { type OptimizeComponentsOptions, optimizeComponents } from "./plugins/optimize-components"; // Vite/Rollup
export { optimizeCss } from "./plugins/optimize-css";                          // Vite/Rollup
export type { OptimizeCssOptions } from "./plugins/options";
export type { SafelistEntry } from "./plugins/safelist";
export { optimizeImports } from "./preprocessors/optimize-imports";            // Svelte preprocessor
```

Keep this surface small: a new export, option or CLI flag is a decision for an issue, not a side effect of another change.

Everything leans on the helpers in [`src/constants.ts`](src/constants.ts) / [`src/utils.ts`](src/utils.ts) (`isSvelteFile`, `isCssFile`, `isCarbonSvelteImport`, the `CarbonSvelte` package-name map, the `bx--` prefix regex).

[`resolve-carbon-root.ts`](src/indexer/resolve-carbon-root.ts) finds the installed `carbon-components-svelte` from the project root (Vite `root`, webpack/Rspack `context`, `optimizeCarbonCss`'s `cwd`, the CLI's `--cwd`), searching from the project first and this package's own install location second, so a hoisted monorepo install still finds the app's Carbon. It uses `require.resolve.paths()` rather than a package.json subpath because Carbon's `exports` map doesn't declare `./package.json`, so a direct `require.resolve` throws under strict Node ESM even though it works under Bun. Everything the CSS tools know about Carbon (which classes each component can render, under which props, and which its stylesheet defines) is read from that install by svelte-prune, so nothing is checked in or shipped, and every consumer runs against whatever Carbon release they have: a gate that only holds for the latest release is a bug.

### `optimizeImports`

[`src/preprocessors/optimize-imports.ts`](src/preprocessors/optimize-imports.ts) is a Svelte `script` preprocessor. Per file:

- **Fast path.** Bail immediately on `node_modules` files and on any file whose raw source does not contain the substring `"carbon-"`. That skips the parse for almost every file. Do not remove this when changing the module.
- `lexImportsExports` from `svelte-ast/lexer` finds the script's top-level `import` statements and their names without a parser, so an `import` inside a comment, string or template is never rewritten. It's a few kB with no acorn, so it loads with the package and keeps the preprocessor synchronous. Each rewritten statement is spliced into the output while svelte-prune's hand-written source map builder (`MappingsBuilder`) tracks it. A statement the lexer can't read comes back without a source and is left alone; Svelte reports any syntax error when it compiles.
- Carbon component names resolve through the installed `carbon-components-svelte`'s own barrel. [`carbon-exports.ts`](src/indexer/carbon-exports.ts) reads `src/index.js`'s `export … from` statements with `lexImportsExports`, synchronously (once per preprocessor instance, and only once a file actually imports from `carbon-components-svelte`) and follows each re-export to the module that defines it: older releases hop through a folder `index.js`, newer ones point straight at the `.svelte` file. A default export becomes `import X from "…"`; a named export stays named (`import { toCsv } from "…/data-table-utils.js"`), since rewriting it to a default import would bind the wrong value or none. Names the barrel doesn't export stay on the barrel. Icons and pictograms map to `lib/Name.svelte`.
- **Type imports stay on the barrel.** `import type { … }` statements are left alone. In `import { type X, Y }`, `X` stays on the barrel and only `Y` is rewritten. Recent fixes ([#138](https://github.com/carbon-design-system/carbon-preprocess-svelte/pull/138), [#133](https://github.com/carbon-design-system/carbon-preprocess-svelte/pull/133)) live here. Add a fixture in [`tests/optimize-imports.test.ts`](tests/optimize-imports.test.ts) for any import-shape change.

### `optimizeCss` (Vite/Rollup) and `OptimizeCssPlugin` (Webpack/Rspack)

Both plugins do the same job through different bundler hooks, then call the same optimizer.

- [`src/plugins/optimize-css.ts`](src/plugins/optimize-css.ts) is the Vite plugin (`apply: "build"`, `enforce: "post"`). It collects Carbon component ids in the `transform` hook, then rewrites CSS assets in `generateBundle` by mutating `file.source` in place. The scanner is synchronous.
- [`src/plugins/OptimizeCssPlugin.ts`](src/plugins/OptimizeCssPlugin.ts) is the Webpack plugin, production-only. It collects ids by reading each module's `resource` in the `finishModules` hook (fires once the whole module graph has resolved, so every Carbon Svelte component already exists as its own module), then processes CSS assets at `PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE` (before minification). All assets are scanned in parallel via `Promise.all`. It is typed against a minimal structural subset of the `Compiler`/`Compilation` API (not imported from the `webpack` package) so the same plugin instance also works unchanged with Rspack, which implements that same `compiler.webpack` namespace for plugin compatibility but does not implement webpack's `NormalModule.getCompilationHooks().beforeSnapshot` hook that an earlier version of this plugin relied on.

Unless `scanModules: false`, both plugins also scan the code of every bundled module (`transform` for Vite, `module.originalSource()` in `finishModules` for Webpack/Rspack) for literal `bx--` tokens, so hand-written classes in app markup survive without `content`/`safelist`. The scan itself, `collectCarbonTokens()`, lives in [`src/plugins/scan-content.ts`](src/plugins/scan-content.ts) and is shared with the `content` glob scan (`scanContent`). Stylesheet modules of any flavor are never scanned (`isScannableModule`): a `.scss` entry that `@import`s Carbon's theme reaches `transform` as compiled CSS and would keep everything.

Both plugins and `createCarbonOptimizer` make their optimizer with `prepareCssPruning()` in [`css-pruning.ts`](src/plugins/css-pruning.ts), which picks the analysis it prunes from: the one `optimizeComponents` shares when it's in the build, else the call sites the caller collected itself.

The shared core is [`src/plugins/create-optimized-css.ts`](src/plugins/create-optimized-css.ts). Each entry point runs svelte-prune's usage analysis first (`createUsageCollector` in the plugins, fed every scannable module and the module graph's edges into Carbon; `analyzeFiles` in `optimizeCarbonCss` and the CLI, fed the `content` files), with the `exclude` and `assume` options (`usageOptions` in [`options.ts`](src/plugins/options.ts)). `checkRemovedOptions` there throws for `propAware`, removed in 0.14.0, so a JavaScript config that still sets it fails instead of pruning differently. `collectedEngine` turns the result into the pruner's inputs. If the analysis fails, the entry point warns and leaves Carbon CSS unpruned: a bigger stylesheet is safe, while pruning against a guess drops rules the installed markup still uses.

The pruner is [`carbon-style-pruner.ts`](src/plugins/carbon-style-pruner.ts): svelte-prune's `libraryStylePruner` with Carbon's stylesheets and `keep` (`ALWAYS_ON_CLASSES` and `CONTEXT_ANCESTORS`), then Carbon's own passes from [`carbon-rules.ts`](src/plugins/carbon-rules.ts): the IBM Plex `@font-face` rules no component uses, and flatpickr and legacy `bx-` rules unless DatePicker renders. svelte-prune's pruner drops a selector when any class in it is one Carbon's stylesheets define and nothing can render, and drops the custom properties and `@keyframes` those stylesheets define that nothing reads. It reads custom properties from its files, so each entry point adds a synthetic file of the `--cds-*` names the build reads elsewhere ([`token-names.ts`](src/plugins/token-names.ts)): the bundle's scripts and markup, the other CSS assets, the `content` files. Without them (the CLI, `optimizeCarbonCss` without `sources`), the file holds a bare `--cds-`, which keeps every token.

Both plugins and the CLI hand their CSS assets to [`optimize-assets.ts`](src/plugins/optimize-assets.ts), which runs the optimizer, writes results back, and prints the size log and report, so only the bundler hooks that collect inputs differ. Keep the two plugins in lockstep when you change behavior. The `report.removed` count suppresses the size-diff log when nothing was pruned ([#131](https://github.com/carbon-design-system/carbon-preprocess-svelte/pull/131)). `optimizeCarbonCss` in [`src/plugins/optimize-carbon-css.ts`](src/plugins/optimize-carbon-css.ts) is the bundler-agnostic wrapper over the same core. Under Vite, [`stylesheet-classes.ts`](src/plugins/stylesheet-classes.ts) lists the classes Carbon's stylesheet defines for the chunk-hash fingerprint.

[`createCarbonOptimizer`](src/plugins/carbon-optimizer.ts) is both plugins without a bundler's hooks: svelte-prune's `createComponentOptimizer` (the core its Vite and webpack plugins share) for the components, and `prepareCssPruning` with the component optimizer's analysis for the CSS. The caller hands it the module graph after the build, which it reads as the Vite plugins read Vite's: the same soundness checks, the same Carbon ids, module classes and tokens. [`optimizeCarbonBun`](src/plugins/bun.ts) builds that graph from `Bun.build`'s metafile. [`optimize-carbon-bun.test.ts`](tests/optimize-carbon-bun.test.ts) builds each golden app with Vite and with Bun and requires byte-identical pruned CSS, so a change to one plugin's inputs has to reach it too.

Supporting modules: [`safelist.ts`](src/plugins/safelist.ts) (string = literal class-token match, RegExp = whole-selector match), [`scan-content.ts`](src/plugins/scan-content.ts) (glob source files for literal `bx--` tokens, for runtime-built class names like `` `bx--btn--${kind}` ``), [`print-diff.ts`](src/plugins/print-diff.ts) (the before/after size log the e2e tests parse; `formatDiff` builds the block as one string, which `logAssetDiff` emits through `config.logger.info` under Vite and `console.log` everywhere else). Safelist and `content` are the user-facing overrides added in [#140](https://github.com/carbon-design-system/carbon-preprocess-svelte/pull/140).

### The analysis: CSS pruning and `optimizeComponents`

The analysis behind both is [svelte-prune](https://github.com/metonym/svelte-prune), bundled into `dist/` like svelte-ast. Its [CONTRIBUTING](https://github.com/metonym/svelte-prune/blob/master/CONTRIBUTING.md) covers how it works and the rules a change to it must keep: fix the analysis there, with a render test, then bump the version here. A bump changes what `dist/` ships, so commit it as `perf` or `fix` rather than `chore(deps-dev)`, and expect it to move the golden sizes. To see what a bump changed, diff `bun scripts/golden-report.ts --full` ([golden/README.md](golden/README.md)) against `main`: `dist/` won't diff cleanly, since svelte-prune ships minified chunks. The component plugins come from svelte-prune's public entries (`svelte-prune/vite`, `svelte-prune/webpack`), the rest from its unstable internal ones (`createCarbonOptimizer` uses `createComponentOptimizer`, the core both plugins share):

- `svelte-prune/internal`: library paths, barrel and package resolution, the module-graph checks, the webpack helpers and loader, and svelte-ast's lexer and walker (import them from here, not from `svelte-ast`, so `dist/` holds one copy). It never loads the parser. Its declarations re-export svelte-ast's types, which is why `svelte-ast` stays a devDependency that nothing imports (`ignoreDependencies` in `knip.json`). Keep it on the version svelte-prune bundles, and rename or bump it only once a svelte-prune release imports that name: until then, typecheck and the `.d.ts` emit can't resolve svelte-prune's types.
- `svelte-prune/internal/analysis`: the analysis and its types. Import it lazily (`await import("svelte-prune/internal/analysis")`), so `svelte.config.js` and builds without the CSS or component plugins never evaluate it or load the parser; `bun run build` fails if `dist/index.js` reaches it statically. Type-only imports are free, and its types must come from it rather than `svelte-prune/internal`: each entry's declarations are rolled up on their own.

Carbon comes in through a `LibrarySpec`, [`CARBON`](src/carbon-library.ts): its package name, barrel, icon packages, `carbon:` context keys, the label and tool name its messages use, and how `bx--` class names are read. [`optimizeComponents`](src/plugins/optimize-components.ts) and [`OptimizeComponentsPlugin`](src/plugins/OptimizeComponentsPlugin.ts) are svelte-prune's plugins with Carbon's spec and names; the webpack loader is built here as [`optimize-components-loader`](src/optimize-components-loader.ts), re-exporting svelte-prune's. [`scripts/bundle-dts.ts`](scripts/bundle-dts.ts) inlines the svelte-prune types the public API uses, since consumers don't install it.

**Unknown must mean open.** Anything the analysis can't read has to keep every value, never be skipped: a missed call site prunes styles or removes code the app runs. So don't skip a file because of what its text lacks, and verify a change to what the analysis removes by rendering: `eval:specialize` (with and without `--unwrap`) and `eval:prop-aware`, with the last release as a control that shows the bug. For a shape Carbon doesn't use (runes, snippets, other barrels), add a render test in svelte-prune.

## Conventions

`bun fmt` and `bun lint` enforce most of this in CI. Both are in Bun canary builds only until 1.4.5 ships, so CI installs canary. On a stable Bun, use the `lint:*` scripts. Config: the `[fmt]`, `[lint]` and `[svelte-lint]` sections of [`bunfig.toml`](bunfig.toml). The recommended rules are on by default, and the extra rules there are errors. Warnings also fail CI. `bun fmt` leaves Markdown and YAML alone.

- **Hoist regexes to module scope.** A regex literal inside a function fails lint, unless it has the `g` or `y` flag. Declare it as a named top-level `const` (see the `*_REGEX` / `CARBON_*` constants at the top of nearly every module).
- **No `await` in loops, no `forEach`.** `no-await-in-loop` and `unicorn/no-array-for-each` are errors. Build the work and `await Promise.all(...)`, or use `for...of` with hoisted awaits. `scripts/`, `examples/` and the build-driven tests turn `no-await-in-loop` off, since they run builds one at a time so each one's output stays readable. Elsewhere, add `// eslint-disable-next-line no-await-in-loop -- <why>`.
- **No namespace imports, no barrel re-exports, no import cycles.** `no-restricted-syntax` and `import/no-cycle`. Export named bindings explicitly, as [`src/index.ts`](src/index.ts) does.
- **No `delete` on a named property, no accumulating spread, prefer arrow functions and dot notation.** `no-restricted-syntax`, `oxc/no-accumulating-spread`, `prefer-arrow-callback`, `dot-notation`.
- **No `bun:test` imports**. The Bun test globals (`describe`, `test`, `expect`) are ambient. Importing them is an error.
- **Use `node:` import specifiers**, e.g. `import path from "node:path"`, as the scripts and plugins do. `unicorn/prefer-node-protocol` is an error.
- **No `enum`, no `@ts-ignore`, no `any`.** `no-restricted-syntax`, `@typescript-eslint/ban-ts-comment`, `@typescript-eslint/no-explicit-any`. Use `@ts-expect-error` when a test must suppress a type error. Use `import type` / `export type` (`@typescript-eslint/consistent-type-imports` and `consistent-type-exports`).
- **No focused or skipped tests.** `jest/no-focused-tests` and `jest/no-disabled-tests`. Do not land `.only` or `.skip`.

TypeScript ([`tsconfig.json`](tsconfig.json)) is check-only (`noEmit`). JS and `.d.ts` come from [`scripts/build.ts`](scripts/build.ts) and [`scripts/bundle-dts.ts`](scripts/bundle-dts.ts). It runs `strict` with `noUnusedLocals`, `noUnusedParameters`, and `erasableSyntaxOnly` (no runtime-emitting TS syntax: enums, parameter properties, etc.). The `carbon-preprocess-svelte` path alias resolves to `src/` so tests import the package by name.

Comment the _why_ behind non-obvious parser, hook-ordering, and CSS-matching logic. The existing modules are heavily annotated; match that density. Skip comments that restate the code.

## Testing

Tests use the Bun test runner and live in [`tests/`](tests), mostly one `*.test.ts` per `src/` module.

```sh
bun run test                       # everything, in parallel
bun run test:changed               # only what your changes can reach
bun test optimize-imports          # filter by file-path substring
bun test tests/utils.test.ts       # a single file
bun test --watch                   # watch mode
```

Three layers, smallest to largest:

### Unit tests

Per-module behavior, e.g. [`optimize-imports.test.ts`](tests/optimize-imports.test.ts), [`create-optimized-css.test.ts`](tests/create-optimized-css.test.ts), [`optimize-components.test.ts`](tests/optimize-components.test.ts) and [`OptimizeComponentsPlugin.test.ts`](tests/OptimizeComponentsPlugin.test.ts), which builds with real webpack. Add a focused case here for any logic change. [`golden-sizes.test.ts`](tests/golden-sizes.test.ts) snapshots the built sizes of the [golden apps](golden/README.md); performance work is measured with the suites in [`bench/`](bench/README.md).

### End-to-end tests

[`tests/test-e2e.ts`](tests/test-e2e.ts) (`bun run test:e2e`) builds the package, `bun link`s it into each project under [`examples/`](examples), builds every example, parses the size log, and compares CSS reduction to [`tests/__snapshots__/e2e.json`](tests/__snapshots__/e2e.json) within 0.01 tolerance. Unit tests will not catch a plugin that silently no-ops inside a real Vite, Webpack, or Rspack build. This suite will — it's how the `finishModules`/`resource` rewrite of `OptimizeCssPlugin` was validated against real Webpack and Rspack builds, since the unit test mock alone could not have caught the timing bug where `buildInfo.fileDependencies` isn't populated yet at `finishModules`.

The examples are real downstream consumers, each linking the package via `"carbon-preprocess-svelte": "link:carbon-preprocess-svelte"`:

- `examples/rollup`, `examples/rolldown`, `examples/vite`, `examples/vite@svelte-5`, `examples/vite@carbon-0.85`, `examples/vite-matrix@svelte-4`, `examples/vite-matrix@svelte-5`, `examples/sveltekit`, `examples/sveltekit-matrix@svelte-5`, `examples/astro`: Vite/Rollup plugin path
- `examples/webpack`, `examples/webpack@svelte-5`: Webpack plugin path
- `examples/rspack`: Rspack plugin path, using the same `OptimizeCssPlugin` export as Webpack

Other Svelte frameworks (Routify, …) run Vite under the hood, so the Vite examples cover them. When you change output shape or reduction behavior, update snapshots and read the diff:

```sh
bun run test:e2e:update
```

`bun run upgrade-examples` takes the in-range updates in each example. Some pins are deliberate, so don't chase `bun outdated` past them: Svelte 4, Vite 5 and Carbon 0.85 are the test matrix. TypeScript 7 has no JS compiler API, and two things still call it: `svelte-preprocess`, which the `webpack` example needs for Svelte 4's `lang="ts"`, and SvelteKit 3. So those two stay on TypeScript 6 and 5.9.

### Against a Carbon checkout

To try unreleased `carbon-components-svelte` work, link the checkout into the project's `node_modules` (`bun link`, `npm link`, a `link:`/`file:` dependency, or `workspace:*`); don't alias it. The CSS tools and `optimizeComponents` resolve `carbon-components-svelte` from the project root ([`resolve-carbon-root.ts`](src/indexer/resolve-carbon-root.ts)), not through the bundler, and a link resolves to the same files for both. A `resolve.alias` (or SvelteKit's `kit.alias`) changes only what the bundler loads, so the optimizers analyze the installed copy while the app bundles the checkout. Nothing fails: `optimizeCss` prunes the CSS of components only the checkout has, and `optimizeComponents` reports rewrites it never serves, since they're keyed by the installed files' paths.

## Build

[`scripts/build.ts`](scripts/build.ts) (`bun run build`) removes `dist/`, copies `README.md` and `LICENSE` into it (before anything generated lands there, so a failed build never leaves a half-written manifest next to missing assets), bundles two entry points, `src/index.ts` (the library) and `src/cli.ts` (the `optimize-css` CLI), with `Bun.build` (minified ESM, Node target, `splitting: true` so the code shared between them, the indexer and the CSS optimizer, is emitted once as a `chunk-*.js` instead of duplicated into both bundles), then runs [`scripts/bundle-dts.ts`](scripts/bundle-dts.ts) to emit `dist/index.d.ts` (the CLI exports no types, so it's skipped there). Rather than mirroring every `src` module into `dist/` (`tsc`'s default behavior), `bundle-dts.ts` uses the TypeScript compiler API (via `@typescript/typescript6`, since TypeScript 7's `typescript` package no longer ships it) to inline only the declarations reachable from `src/index.ts`'s public exports into a single tree-shaken file. After the bundle step, `dist/cli.js` gets a `#!/usr/bin/env node` shebang and is `chmod`ed executable (Bun's build strips shebangs), and the static-`svelte`-import guard runs over every emitted `.js` file under `dist/`, not just `index.js`, since splitting can move code into a shared chunk. Finally the build writes `dist/package.json`: a copy of the root manifest with `devDependencies`, `scripts`, and `files` stripped, and `main`/`types`/`bin`/`exports` rewritten from `./dist/*` to `./*` so paths resolve once `dist/` is published as the tarball root. `dist/` is gitignored and never committed. `bun run build -w` rebuilds on changes under `src/` and keeps linked examples current.

## Continuous integration

[`.github/workflows/test.yml`](.github/workflows/test.yml) runs on every PR and on pushes to `main` (Ubuntu runner):

1. `bun ci`
2. `bun run lint`
3. `bun run typecheck`
4. `bunx bivium check --max-unknown 0`
5. `bun run test`
6. `bun run test:package`
7. `bun run test:e2e`

On a PR, `bivium plan` decides which of steps 5 to 7 run: the unit tests a change can reach, and `test:package` and `test:e2e` only when a change can reach them. Pushes to `main` run everything. bivium follows imports; a file that reads one of this repository's files from disk (a fixture, a golden app, an example) names it with `// @reads <glob>`, or the plan misses it. `src/`, `tests/*.test.ts` and `tests/helpers/` are `hermetic` in `bivium.config.ts`: their other disk reads are the user's project, the installed Carbon packages, or temp directories. `bunx bivium why <test>` shows why a test was picked, and `bunx bivium check` lists anything the plan can't read.

Run those locally before pushing. The e2e suite runs in CI, so a snapshot you forgot to update will fail the build; the failed run uploads what it observed, and `bun run snapshots:from-ci` writes it to `e2e.json` when the change is intended.

[`.github/workflows/eval.yml`](.github/workflows/eval.yml) runs the accuracy checks when the analyzer, the indexer, the plugins, the examples or the golden apps change: `eval:prop-aware`, `eval:specialize` on Svelte 3, 4 and 5 (and 5 with `--unwrap`), and the golden apps. [`.github/workflows/bench.yml`](.github/workflows/bench.yml) pairs every benchmark on a PR against its base with `ostia ab` and writes the comparison to the job summary.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>
```

- Common types: `fix`, `feat`, `perf`, `chore`, `test`, `docs`, `refactor`.
- Scope is the area touched: `optimize-css`, `optimize-imports`, `optimize-components`, `analyzer`, `index`, `cli`, `webpack`, `examples`, `e2e`, `eval`, `deps-dev`, `ci`.
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

1. Bump `version` in [`package.json`](package.json).
2. Commit with the version as the message, tag, and push the tag:

```sh
git commit -am "v0.11.37"
git tag v0.11.37
git push origin v0.11.37
```

A successful workflow publishes the new version to NPM.

### Post-release

1. Create a [new release](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/new) on GitHub with the release's notes, and publish it as the latest release. The GitHub release is the only record of a release's changes; releases before 0.13.0 are in [`docs/archive/CHANGELOG.md`](docs/archive/CHANGELOG.md), which isn't updated.
2. Close out any issues resolved in the release.
