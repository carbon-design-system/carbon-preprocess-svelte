# Contributing

## Prerequisites

[Bun](https://bun.sh/) is used to develop this project.

## Set-up

Fork the repository and clone your fork:

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

Finally, install the project dependencies:

```sh
bun install
```

## Workflow

Imports for `carbon-components-svelte` must be regenerated if the `carbon-components-svelte` package is updated (i.e., a new component is added).

To update the imports, run the following command:

```sh
bun run index:components
```

This will update `src/component-index.ts`, which should be checked into source control.

Note that for this package, `carbon-components-svelte` is intentionally a `devDependency`, as it is only used for generating the component index, and not depended on at runtime.

### Unit tests

Run `bun test` to execute the unit tests (located in `/tests`).

For watch mode, run `bun test --watch`.

To update snapshots, run `bun test --update-snapshots`.

### Linked examples

To simulate real-world usage of the package, you can link the package to an example project. This is useful for testing changes end-to-end.

Example set-ups are located in the `examples` directory:

- `examples/rollup`: Rollup (Vite-compatible API)
- `examples/sveltekit`: SvelteKit
- `examples/vite`: Vite
- `examples/vite@svelte-5`: Vite using Svelte 5
- `examples/webpack`: Webpack

Note that other Svelte frameworks use Vite under the hood (e.g., Astro, Routify).

`carbon-preprocess-svelte` is linked locally in these examples, so changes to the package will be reflected in the example projects.

Rebuilding the project in watch mode will automatically update the linked examples.

```sh
bun run build -w
```

### End-to-end tests

The e2e tests build all examples and verify that CSS optimization results match expected snapshots. This guards against regressions.

```sh
bun run test:e2e
```

Snapshots are stored in `tests/__snapshots__/e2e.json` and track before/after file sizes and reduction percentages.

If the CSS optimization improves (a progression), update the snapshots:

```sh
bun run test:e2e:update
```

## Submitting a Pull Request

### Sync Your Fork

Before submitting a pull request, make sure your fork is up to date with the latest upstream changes.

```sh
git fetch upstream
git checkout main
git merge upstream/main
```

### Submit a PR

After you've pushed your changes to remote, submit your PR. Make sure you are comparing `<YOUR_USER_ID>/feature` to `origin/main`.

## Maintainer guide

The following items only apply to project maintainers.

### Release

This library is published to NPM with [provenance](https://docs.npmjs.com/generating-provenance-statements) via a [GitHub workflow](https://github.com/carbon-design-system/carbon-icons-svelte/blob/master/.github/workflows/release.yml).

The workflow is automatically triggered when pushing a tag that begins with `v` (e.g., `v0.9.0`).

However, maintainers must perform a few things in preparation for a release.

### Pre-release checklist

1. Update `CHANGELOG.md` and increment `package.json#version`.

```diff
-  "version": "0.8.0",
+  "version": "0.9.0",
```

2. Commit the changes and tag the release.

```sh
git commit -am "v0.9.0"
git tag v0.9.0
```

3. Push the tag to the remote.

Finally, push the tag to the remote repository.

This will trigger the `release.yml` workflow. If the build steps succeed, the new version of the packge will be published to NPM.

### Post-release checklist

After confirming that the new release is published to NPM, perform the following:

1. Create a [new release](https://github.com/carbon-design-system/carbon-preprocess-svelte/releases/new) on GitHub.

2. Publish the release as the latest release.

3. Close out any issues that were resolved in the release.
