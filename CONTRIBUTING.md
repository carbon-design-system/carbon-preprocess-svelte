# Contributing

## Prerequisites

For MacOS, prerequisites include [Node.js](https://nodejs.org/en/download/package-manager/#macos)(version 14 or greater) and [Yarn](https://yarnpkg.com/en/docs/install#mac-stable).

## Set-up

Fork the repository and clone your fork:

```sh
git clone <YOUR_FORK>
cd carbon-preprocess-svelte
```

Set the original repository as the upstream:

```sh
git remote add upstream git@github.com:IBM/carbon-preprocess-svelte.git
# verify that the upstream is added
git remote -v
```

Finally, install the project dependencies:

```sh
yarn install
```

## Workflow

Each preprocessor or plugin should have an integration test. Before running tests, be sure to build the library at least once.

```sh
yarn prepack
```

### Unit tests

Run `yarn test:unit` to execute the unit tests (located in `/tests/unit`).

### Integration tests

Run `yarn test:integration` to execute the integration tests (located in `/tests/integration`).

### Continuous Integration

The `yarn prepack` command is executed in Travis CI.

It does the following:

1. Build the library
2. Run unit/integration tests in parallel

The CI should pass if no unexpected errors occur.

## Submitting a Pull Request

### Sync Your Fork

Before submitting a pull request, make sure your fork is up to date with the latest upstream changes.

```sh
git fetch upstream
git checkout master
git merge upstream/master
```

### Submit a PR

After you've pushed your changes to remote, submit your PR. Make sure you are comparing `<YOUR_USER_ID>/feature` to `origin/master`.
