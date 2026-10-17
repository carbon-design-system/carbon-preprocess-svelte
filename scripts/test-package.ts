// Packs dist/, installs the tarball into a scratch project next to Vite and
// Svelte, and checks it the way a consumer would: every export loading in
// Node, the CLI running, and the types resolving through `exports` with
// nothing but what a Svelte project has installed.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $ } from "bun";

const root = resolve(import.meta.dir, "..");
const dir = await mkdtemp(join(tmpdir(), "carbon-preprocess-svelte-package-"));

try {
  await $`bun run build`.cwd(root).quiet();

  const manifest = JSON.parse(
    await readFile(join(root, "dist/package.json"), "utf8"),
  );
  for (const field of ["dependencies", "peerDependencies"]) {
    if (manifest[field]) throw new Error(`dist/package.json has ${field}`);
  }

  const packed = await $`npm pack --pack-destination ${dir} --silent`
    .cwd(join(root, "dist"))
    .text();
  const tarball = join(dir, packed.trim());

  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module" }),
  );
  // No bundler yet: a webpack project has none of Vite, Rollup or Rolldown.
  await $`npm install ${tarball} svelte @types/node --no-audit --no-fund --silent`.cwd(
    dir,
  );

  await writeFile(
    join(dir, "smoke.js"),
    `import assert from "node:assert/strict";
import * as cps from "carbon-preprocess-svelte";

for (const name of ["optimizeImports", "optimizeCss", "optimizeComponents", "optimizeCarbonCss", "OptimizeCssPlugin", "OptimizeComponentsPlugin"]) {
  assert.ok(cps[name], name);
}
assert.equal(typeof cps.optimizeImports().script, "function");
assert.equal(cps.optimizeCss().name, "vite:carbon:optimize-css");
assert.equal(cps.optimizeComponents().apply, "build");
`,
  );
  await $`node smoke.js`.cwd(dir);
  await $`node ${join(dir, "node_modules/carbon-preprocess-svelte/cli.js")} --help`.quiet();

  const IMPORTS = `import {
  OptimizeComponentsPlugin,
  type OptimizeComponentsOptions,
  OptimizeCssPlugin,
  type OptimizeCssOptions,
  optimizeCarbonCss,
  optimizeComponents,
  optimizeCss,
  optimizeImports,
  type SafelistEntry,
} from "carbon-preprocess-svelte";
import type { PreprocessorGroup } from "svelte/compiler";
`;
  const OPTIONS = `const safelist: SafelistEntry[] = ["bx--grid", /^\\.bx--col/];
const css: OptimizeCssOptions = {
  safelist,
  content: ["src/**/*.svelte"],
  propAware: { exclude: ["Modal"], assume: { Button: { kind: ["ghost"] } } },
};
const components: OptimizeComponentsOptions = { unwrap: false, report: true };
const preprocess: PreprocessorGroup[] = [optimizeImports()];
const webpack = [new OptimizeCssPlugin(css), new OptimizeComponentsPlugin(components)];
const report = await optimizeCarbonCss("", { components: ["Button"] });
void preprocess;
void webpack;
void report;
`;
  const tsconfig = (file: string) =>
    JSON.stringify({
      compilerOptions: {
        noEmit: true,
        strict: true,
        module: "nodenext",
        moduleResolution: "nodenext",
        target: "es2022",
        lib: ["esnext", "dom"],
        skipLibCheck: false,
        types: ["node"],
      },
      files: [file],
    });
  const tsc = join(root, "node_modules/.bin/tsc");

  await writeFile(
    join(dir, "webpack.ts"),
    `${IMPORTS}\n${OPTIONS}void optimizeCss;\nvoid optimizeComponents;\n`,
  );
  await writeFile(join(dir, "tsconfig.webpack.json"), tsconfig("webpack.ts"));
  await $`${tsc} -p tsconfig.webpack.json`.cwd(dir);

  await $`npm install vite --no-audit --no-fund --silent`.cwd(dir);
  await writeFile(
    join(dir, "vite.ts"),
    `${IMPORTS}import type { Plugin } from "vite";\n\n${OPTIONS}const plugins: Plugin[] = [optimizeCss(css), optimizeComponents(components)];\nvoid plugins;\n`,
  );
  await writeFile(join(dir, "tsconfig.json"), tsconfig("vite.ts"));
  // The types name no Svelte's, so each major's own must accept them.
  // Svelte 3's own types don't check with `skipLibCheck: false`.
  for (const svelte of ["5", "4"]) {
    // biome-ignore lint/performance/noAwaitInLoops: one install at a time
    await $`npm install svelte@${svelte} --no-audit --no-fund --silent`.cwd(
      dir,
    );
    await $`${tsc} -p tsconfig.json`.cwd(dir);
  }

  console.log(
    "✓ Every export loads in Node, the CLI runs, and the types check for webpack and Vite consumers on Svelte 4 and 5",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
