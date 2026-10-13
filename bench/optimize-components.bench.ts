import { readFileSync } from "node:fs";
import path from "node:path";
import { group, task } from "ostia";
import { CARBON, SPECIALIZE_FAILURE } from "../src/carbon-library";
import { resolveCarbonRoot } from "../src/indexer/resolve-carbon-root";
import { libraryAt } from "../src/specializer/library";
import {
  libraryImports,
  type ModuleGraph,
} from "../src/specializer/module-graph";
import { createComponentOptimizer } from "../src/specializer/optimizer";

/**
 * What `optimizeComponents` and `OptimizeComponentsPlugin` add to a build
 * besides the analysis itself: reading `content` before each build (cold,
 * and on a watch rebuild where nothing in it changed), and checking every
 * transformed module for Carbon imports from outside `content`, and
 * checking the module graph's edges into Carbon when the build ends.
 */
// The vite-matrix app and its wrapper, frozen like the analyzer's fixtures.
const root = path.join(import.meta.dirname, "fixtures/wrapper");
const options = { silent: true, content: ["*.svelte"] };
const BENCH = { plugin: "bench", failure: SPECIALIZE_FAILURE };

group("optimizeComponents: prepare (vite-matrix app)", () => {
  task("cold: a new build", async () => {
    await createComponentOptimizer(CARBON, options, BENCH).prepare(root);
  });
  const warm = createComponentOptimizer(CARBON, options, BENCH);
  task("watch rebuild: `content` unchanged", async () => {
    await warm.prepare(root);
  });
});

// 500 transformed modules: the app's own, 450 scripts with no Carbon
// import, 40 that import it from outside `content`, and Carbon's own
// files, which are skipped.
const app = readFileSync(path.join(root, "App.svelte"), "utf8");
const modules = [
  { id: path.join(root, "App.svelte"), code: app },
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
const checker = createComponentOptimizer(CARBON, options, BENCH);
await checker.prepare(root);

group("optimizeComponents: check every transformed module", () => {
  task(`check × ${modules.length}`, () => {
    for (const { id, code } of modules) checker.check(id, code, root);
  });
});

// What `buildEnd` reads from the module graph: every edge into Carbon's
// components and barrel. The app imports 90 components from the barrel
// and 10 by path; 40 modules outside `content` import Carbon too, 10 of
// them through an alias the graph resolves to the barrel.
const carbon = libraryAt(CARBON, resolveCarbonRoot(root));
const barrel = path.join(carbon.src, carbon.barrelKey);
const componentIds = [...carbon.components.values()]
  .slice(0, 100)
  .map((key) => path.join(carbon.src, key));
const appFile = path.join(root, "App.svelte");
const outside = Array.from({ length: 40 }, (_, i) =>
  path.join(root, `lib/outside${i}.ts`),
);
const importers = new Map<string, string[]>([
  [barrel, [appFile, ...outside]],
  ...componentIds.map((id, i): [string, string[]] => [
    id,
    i < 90 ? [barrel] : [appFile],
  ]),
]);
const codes = new Map<string, string>([
  [appFile, app],
  ...outside.map((file, i): [string, string] => [
    file,
    `import { Button } from "${i < 10 ? "@carbon" : CARBON.name}";\nexport const B${i} = Button;\n`,
  ]),
]);
const graph: ModuleGraph = {
  getModuleIds: () => [barrel, ...componentIds, ...codes.keys()].values(),
  getModuleInfo: (id) => ({
    code: codes.get(id),
    importers: importers.get(id) ?? [],
    dynamicImporters: [],
  }),
  resolve: async (source) => (source === "@carbon" ? { id: barrel } : null),
};
const edges = await libraryImports(CARBON, graph);

group("optimizeComponents: buildEnd checks", () => {
  task("libraryImports (module graph edges into Carbon)", async () => {
    await libraryImports(CARBON, graph);
  });
  task(`checkLibraryImport × ${edges.length}`, () => {
    for (const edge of edges) checker.checkLibraryImport(edge, root);
  });
});
