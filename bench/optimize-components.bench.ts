import { readFileSync } from "node:fs";
import path from "node:path";
import { group, task } from "ostia";
import { createComponentOptimizer } from "../src/plugins/component-optimizer";

/**
 * What `optimizeComponents` and `OptimizeComponentsPlugin` add to a build
 * besides the analysis itself: reading `content` before each build (cold,
 * and on a watch rebuild where nothing in it changed), and checking every
 * transformed module for Carbon imports from outside `content`.
 */
const root = path.join(import.meta.dirname, "../examples/vite-matrix@svelte-5");
const options = { silent: true, content: ["src/**/*.{svelte,js}"] };

group("optimizeComponents: prepare (vite-matrix app)", () => {
  task("cold: a new build", async () => {
    await createComponentOptimizer(options, "bench").prepare(root);
  });
  const warm = createComponentOptimizer(options, "bench");
  task("watch rebuild: `content` unchanged", async () => {
    await warm.prepare(root);
  });
});

// 500 transformed modules: the app's own, 450 scripts with no Carbon
// import, 40 that import it from outside `content`, and Carbon's own
// files, which are skipped.
const app = readFileSync(path.join(root, "src/App.svelte"), "utf8");
const modules = [
  { id: path.join(root, "src/App.svelte"), code: app },
  ...Array.from({ length: 450 }, (_, i) => ({
    id: path.join(root, `src/lib/util${i}.ts`),
    code: `export const value${i} = ${i};\n`.repeat(20),
  })),
  ...Array.from({ length: 40 }, (_, i) => ({
    id: path.join(root, `lib/outside${i}.ts`),
    code: `import { Button } from "carbon-components-svelte";\nexport const B${i} = Button;\n`,
  })),
  ...Array.from({ length: 9 }, (_, i) => ({
    id: path.join(
      root,
      `node_modules/carbon-components-svelte/src/Button/Button${i}.svelte`,
    ),
    code: "<button />",
  })),
];
const checker = createComponentOptimizer(options, "bench");
await checker.prepare(root);

group("optimizeComponents: check every transformed module", () => {
  task(`check × ${modules.length}`, () => {
    for (const { id, code } of modules) checker.check(id, code, root);
  });
});
