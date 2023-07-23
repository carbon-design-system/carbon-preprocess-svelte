# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
