# Contributing

## Prerequisites

For MacOS, prerequisites include Node.js and Bun.

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

Imports for `carbon-components-svelte` must be regenerated if the `carbon-components-svelte` package is updated.

To update the imports, run the following command:

```sh
bun run index:components
```

This will update `src/component-index.ts`, which should be checked into source control.

### Unit tests

Run `bun test` to execute the unit tests (located in `/tests`).

For watch mode, run `bun test --watch`.

To update snapshots, run `bun test --update-snapshots`.

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
