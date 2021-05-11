# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0](https://github.com/IBM/carbon-preprocess-svelte/releases/tag/v0.1.0) - 2021-05-11

**Documentation**

- improve preprocessor descriptions, add sample SvelteKit set-up

## [0.1.0-rc.5](https://github.com/IBM/carbon-preprocess-svelte/releases/tag/v0.1.0-rc.5) - 2021-05-11

**Fixes**

- add separate entry point for CJS bundle

## [0.1.0-rc.4](https://github.com/IBM/carbon-preprocess-svelte/releases/tag/v0.1.0-rc.4) - 2021-05-10

**Fixes**

- add TypeScript as a direct dependency

## [0.1.0-rc.3](https://github.com/IBM/carbon-preprocess-svelte/releases/tag/v0.1.0-rc.3) - 2021-05-10

**Features**

- use `svelte-preprocess` in the `optimizeCss` plugin to parse TypeScript syntax in Svelte components

**Documentation**

- list available theme options for the `elements` preprocessor

## [0.1.0-rc.2](https://github.com/IBM/carbon-preprocess-svelte/releases/tag/v0.1.0-rc.2) - 2021-05-08

**Fixes**

- add `purgecss` as a dependency and exclude from bundle

**Documentation**

- add `optimizeCss` API to README

## [0.1.0-rc.1](https://github.com/IBM/carbon-preprocess-svelte/releases/tag/v0.1.0-rc.1) - 2021-05-08

**Fixes**

- elements: only replace token in property instead of the entire property
- elements: do not emit warning if token is falsy
- add exports map to `package.json` so `svelte.config.js` works properly
- temporarily omit `optimizeCss` plugin from library

**Documentation**

- use ESM instead of CJS syntax in `svelte.config.js` usage examples

## [0.1.0-rc.0](https://github.com/IBM/carbon-preprocess-svelte/releases/tag/v0.1.0-rc.0) - 2021-05-07

- initial release
