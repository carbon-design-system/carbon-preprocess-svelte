# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.11.26](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.26) - 2026-02-16

**Fixes**

- re-index exports using `carbon-components-svelte@0.101.0`

## [0.11.25](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.25) - 2026-02-03

**Fixes**

- `optimizeImports`: use MagicString `update()` and chain `replace()` to avoid overwriting appended content

**Performance**

- minify bundle

## [0.11.24](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.24) - 2026-01-31

**Performance**

- `optimizeCss`: use `Set<string>` for component IDs to enable O(1) lookup
- `OptimizeCssPlugin`: skip dev builds, use async processing

## [0.11.23](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.23) - 2026-01-27

**Fixes**

- re-index exports using `carbon-components-svelte@0.99.0`

## [0.11.22](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.22) - 2026-01-18

**Fixes**

- include types

## [0.11.21](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.21) - 2026-01-18

**Fixes**

- switch build output to ESM format
- update webpack examples to use ESM config

## [0.11.20](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.20) - 2026-01-18

**Fixes**

- `optimizeImports` hoists regexes for performance

## [0.11.19](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.19) - 2025-12-26

**Fixes**

- `optimizeImports` uses optimistic path for new components

## [0.11.18](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.18) - 2025-12-21

**Fixes**

- re-index exports using `carbon-components-svelte@0.98.0`

## [0.11.17](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.17) - 2025-12-21

**Fixes**

- re-index exports using `carbon-components-svelte@0.97.0`

## [0.11.16](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.16) - 2025-12-01

**Fixes**

- re-index exports using `carbon-components-svelte@0.95.0`

## [0.11.15](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.15) - 2025-11-29

**Fixes**

- re-index exports using `carbon-components-svelte@0.94.0`

## [0.11.14](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.14) - 2025-11-22

**Fixes**

- re-index exports using `carbon-components-svelte@0.93.0`

## [0.11.13](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.13) - 2025-11-10

**Fixes**

- re-index exports using `carbon-components-svelte@0.91.0`

## [0.11.12](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.12) - 2025-10-31

**Fixes**

- re-index component classes using `carbon-components-svelte@0.90.1`

## [0.11.11](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.11) - 2025-02-27

**Fixes**

- `optimizeImports`: preserve type imports

## [0.11.10](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.10) - 2025-01-19

**Fixes**

- `optimizeCss`: update component index to include nested component selectors

## [0.11.9](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.9) - 2024-12-09

**Features**

- `optimizeImports`: re-index `carbon-components-svelte@0.87` components to support `toHierarchy`

**Fixes**

- `optimizeImports`: append line break to optimized path

## [0.11.8](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.8) - 2024-11-30

**Fixes**

- de-dupe selectors in component index
- preserve comments in TypeScript definitions

## [0.11.7](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.7) - 2024-09-18

**Fixes**

- fix `OptimizeCssPlugin` to convert buffer to string
- patch `postcss` and `postcss-discard-empty` dependencies

## [0.11.6](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.6) - 2024-08-20

**Fixes**

- remove code comments from transpiled code

## [0.11.5](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.5) - 2024-07-28

**Fixes**

- omit pretty printing component index to reduce package size

## [0.11.4](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.4) - 2024-07-28

**Fixes**

- `optimizeCss`: do not remove custom `@font-face` rules if `preserveAllIBMFonts` is `false`

## [0.11.3](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.3) - 2024-04-29

**Fixes**

- `optimizeImports`: use `walk` from `estree-walker` directly for Svelte 5 compatibility

## [0.11.2](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.2) - 2024-04-08

**Fixes**

- `optimizeCss`: do not print diff if value is zero

## [0.11.1](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.1) - 2024-04-07

**Fixes**

- `optimizeCss`: only remove selectors containing the Carbon `bx--` prefix

## [0.11.0](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.11.0) - 2024-03-23

**Breaking Changes**

- Remove all preprocessors except for `optimizeImports`
- `optimizeImports`: drop support for `carbon-icons-svelte` version 10, `carbon-pictograms-svelte` version 10
- Rewrite `optimizeCss` plugin from scratch; it's now offered as a Vite/Rollup/Webpack plugin. `carbon-components-svelte@0.85.0` or greater is required

## [0.10.0](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.10.0) - 2023-07-23

**Breaking Changes**

- upgrade `svelte-preprocess` from v4.10.7 to v5.0.3 to support TypeScript 5

**Fixes**

- support `carbon-icons-svelte@12`

## [0.9.1](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.9.1) - 2022-06-19

- bump `svelte-preprocess` from v4.10.5 to v4.10.7

## [0.9.0](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.9.0) - 2022-04-17

- upgrade `carbon-components-svelte` to v0.63.0 and rebuild components API used by `optimizeImports`
- set latest major version of `carbon-pictograms-svelte` to `12`

## [0.8.2](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.8.2) - 2022-04-10

- set latest major version of `carbon-icons-svelte` to `11`

## [0.8.1](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.8.1) - 2022-04-10

- hot fix to re-build components imports map using a non-linked version of `carbon-components-svelte`

## [0.8.0](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.8.0) - 2022-04-10

- upgrade `@carbon/icons` to v11.0.1
- update `optimizeImports` to support `carbon-icons-svelte@11` component imports

## [0.7.0](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.7.0) - 2022-03-19

- upgrade `carbon-components-svelte` to v0.62.0 to account for the removed `Copy` component and inlined icon components

## [0.6.0](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.6.0) - 2021-07-11

- upgrade `carbon-components-svelte` to v0.40.0 to include `Breakpoint`, `Theme` components for `optimizeImports`

## [0.5.0](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.5.0) - 2021-07-05

- upgrade `carbon-components-svelte` to v0.39.0 to include `RecursiveList`, `TreeView` components for `optimizeImports`

## [0.4.0](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.4.0) - 2021-06-28

**Features**

- upgrade `carbon-components-svelte` to v0.38.0 to include `ProgressBar` component for `optimizeImports`

**Fixes**

- default `include` preprocessor entry test regex to high-level test option

## [0.3.0](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.3.0) - 2021-05-21

**Features**

- add `test` option to `include` preprocessor to filter filenames

**Fixes**

- support custom `test` regex per script/markup object in `include` preprocessor

## [0.2.0](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.2.0) - 2021-05-21

**Features**

- add `include` preprocessor that prepends or appends arbitrary content to the script and markup blocks

**Documentation**

- enrich preprocessor descriptions
- simplify sample SvelteKit set-up

## [0.1.0](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.1.0) - 2021-05-11

**Documentation**

- improve preprocessor descriptions, add sample SvelteKit set-up

## [0.1.0-rc.5](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.1.0-rc.5) - 2021-05-11

**Fixes**

- add separate entry point for CJS bundle

## [0.1.0-rc.4](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.1.0-rc.4) - 2021-05-10

**Fixes**

- add TypeScript as a direct dependency

## [0.1.0-rc.3](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.1.0-rc.3) - 2021-05-10

**Features**

- use `svelte-preprocess` in the `optimizeCss` plugin to parse TypeScript syntax in Svelte components

**Documentation**

- list available theme options for the `elements` preprocessor

## [0.1.0-rc.2](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.1.0-rc.2) - 2021-05-08

**Fixes**

- add `purgecss` as a dependency and exclude from bundle

**Documentation**

- add `optimizeCss` API to README

## [0.1.0-rc.1](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.1.0-rc.1) - 2021-05-08

**Fixes**

- elements: only replace token in property instead of the entire property
- elements: do not emit warning if token is falsy
- add exports map to `package.json` so `svelte.config.js` works properly
- temporarily omit `optimizeCss` plugin from library

**Documentation**

- use ESM instead of CJS syntax in `svelte.config.js` usage examples

## [0.1.0-rc.0](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/tag/v0.1.0-rc.0) - 2021-05-07

- initial release
