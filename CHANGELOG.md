# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
