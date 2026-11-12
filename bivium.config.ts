import { defineConfig } from "bivium";

export default defineConfig({
  suites: {
    unit: {
      tests: "tests/*.test.ts",
      run: "bun test --parallel {files}",
      root: "tests",
      // Read by the e2e suite, never by `bun test`.
      nonInputs: ["tests/test-e2e.ts", "tests/__snapshots__/e2e.json"],
      // `bun test` runs the code: an `import type` or a declaration file
      // can't change what a test does.
      types: false,
    },
    package: {
      tests: "scripts/test-package.ts",
      root: "scripts/test-package.ts",
    },
    e2e: {
      tests: "tests/test-e2e.ts",
      root: "examples",
    },
  },
  roots: [
    "src",
    "tests",
    "scripts",
    "examples",
    "golden",
    "bench",
    "package.json",
    "tsconfig.json",
  ],
  // Lint config and workflows that run none of these suites.
  ignore: [
    "**/*.md",
    "LICENSE",
    ".gitignore",
    // Options for `bun fmt`, `bun lint` and svelte-lint only.
    "bunfig.toml",
    "knip.json",
    ".github/FUNDING.yml",
    ".github/workflows/{bench,eval,release}.yml",
  ],
  // Each test's snapshot, which `bun test` reads beside it.
  reads: { "tests/*.test.ts": "tests/__snapshots__/$1.test.ts.snap" },
  // The CLI the test spawns, which it doesn't import.
  edges: { "tests/cli.test.ts": "src/cli.ts" },
  // Tools CI runs on its own: a bump that only reaches them selects nothing.
  inert: ["knip", "ostia", "svelte-lint", "svelte-typecheck", "@types/*"],
  // tsconfig `paths`: tests and examples import the package by name.
  alias: { "carbon-preprocess-svelte": "src" },
  // The preprocessors and plugins read their user's project and the
  // installed carbon-components-svelte, never this repository; most tests
  // read only the temp projects they write. A file here that reads one of
  // this repository's files still names it with `// @reads <glob>`.
  hermetic: [
    "src/**",
    "tests/*.test.ts",
    "tests/helpers/**",
    "scripts/bundle-dts.ts",
  ],
});
