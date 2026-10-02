import { readFile } from "node:fs/promises";
import path from "node:path";
import { CarbonSvelte } from "../constants";
import { isSvelteFile } from "../utils";
import { readCarbonExports } from "./carbon-exports";
import {
  extractCssIndexAdditions,
  resolveCarbonCssPath,
} from "./extract-css-context";
import {
  buildRuntimeClassMap,
  type ModuleGraphCache,
} from "./extract-runtime-classes";
import { extractFromSvelte } from "./extract-selectors";
import { listJsAndSvelteFiles } from "./list-files";
import { mergeSubComponentClasses } from "./merge-sub-component-classes";
import { resolveCarbonRoot } from "./resolve-carbon-root";

export { resolveCarbonRoot } from "./resolve-carbon-root";

const SRC_PREFIX = `${CarbonSvelte.Components}/src/`;

type ComponentEntry = { path: string; classes: string[] };

/** Component name -> source path and the CSS classes it owns. */
export type ComponentIndex = Record<string, ComponentEntry>;

/** Times `fn` and reports it as `label` through `onTiming`. */
async function timed<T>(
  label: string,
  onTiming: ((label: string, ms: number) => void) | undefined,
  fn: () => Promise<T> | T,
): Promise<T> {
  const start = performance.now();
  const result = await fn();
  onTiming?.(label, performance.now() - start);
  return result;
}

/**
 * Builds the component index directly from an installed
 * `carbon-components-svelte`. `./load-index.ts` caches the result on disk.
 */
export async function buildComponentIndex(options?: {
  carbonRoot?: string;
  onTiming?: (label: string, ms: number) => void;
}): Promise<ComponentIndex> {
  const onTiming = options?.onTiming;
  const carbonRoot = options?.carbonRoot ?? resolveCarbonRoot();
  const carbonSrc = path.join(carbonRoot, "src");
  const totalStart = performance.now();

  // Export name -> its defining module, src-relative (`Button/Button.svelte`).
  const exportedModules = new Map<string, string>();
  for (const [name, target] of readCarbonExports(carbonRoot)) {
    exportedModules.set(name, target.path.slice(SRC_PREFIX.length));
  }
  const exportedKeys = new Set(exportedModules.values());

  const subComponents = new Map<string, string[]>();
  const slotWrapperClasses = new Map<string, string[]>();
  const internalComponents = new Map<string, ComponentEntry>();
  /** src-relative module path -> its scanned entry. */
  const fileEntries = new Map<string, ComponentEntry>();
  const moduleGraph: ModuleGraphCache = {
    importsByModule: new Map(),
    runtimeByModule: new Map(),
    files: new Set(),
  };

  await timed("component scan", onTiming, async () => {
    const allFiles = await listJsAndSvelteFiles(carbonSrc);
    moduleGraph.files = new Set(allFiles);
    const files = allFiles.filter((file) => !file.startsWith("icons/"));

    const extracted = await Promise.all(
      files.map(async (file) =>
        isSvelteFile(file)
          ? extractFromSvelte({
              code: await readFile(path.join(carbonSrc, file), "utf8"),
              filename: file,
            })
          : undefined,
      ),
    );

    for (const [i, file] of files.entries()) {
      const moduleName = path.parse(file).name;
      const entry: ComponentEntry = {
        path: `${SRC_PREFIX}${file}`,
        classes: [],
      };
      fileEntries.set(file, entry);

      const result = extracted[i];
      if (result) {
        entry.classes = result.classes;

        if (result.components.length > 0) {
          subComponents.set(moduleName, result.components);
        }
        if (result.slotWrappers.length > 0) {
          slotWrapperClasses.set(moduleName, result.slotWrappers);
        }

        moduleGraph.importsByModule.set(file, result.imports);

        // Module-script classes travel with imports, so a component that
        // imports a hoisted constant from another component gets its classes.
        const graphClasses = [
          ...result.runtimeClasses,
          ...result.moduleClasses,
        ];
        if (graphClasses.length > 0) {
          moduleGraph.runtimeByModule.set(file, new Set(graphClasses));
        }
      }

      if (!exportedKeys.has(file) && isSvelteFile(file)) {
        internalComponents.set(moduleName, entry);
      }
    }
  });

  const exportsMap = new Map<string, ComponentEntry>();
  const moduleToComponent = new Map<string, string>();

  for (const [name, moduleKey] of exportedModules) {
    const entry = fileEntries.get(moduleKey);
    if (!entry) continue;
    // A copy: aliases of one module merge classes independently.
    exportsMap.set(name, { path: entry.path, classes: [...entry.classes] });
    moduleToComponent.set(moduleKey, name);
  }

  mergeSubComponentClasses(
    subComponents,
    new Map([...exportsMap, ...internalComponents]),
  );

  const markupClasses = new Map(
    [...exportsMap].map(([name, entry]) => [name, new Set(entry.classes)]),
  );

  const [{ context, orphans }, runtimeClasses] = await Promise.all([
    timed("css index", onTiming, async () =>
      extractCssIndexAdditions({
        componentClasses: markupClasses,
        slotWrapperClasses,
        subComponents,
        css: await readFile(resolveCarbonCssPath(carbonRoot), "utf8"),
      }),
    ),
    timed("runtime graph", onTiming, () =>
      buildRuntimeClassMap(carbonSrc, moduleToComponent, moduleGraph),
    ),
  ]);

  for (const additions of [runtimeClasses, context, orphans]) {
    for (const [component, classes] of additions) {
      const entry = exportsMap.get(component);
      if (entry) entry.classes = [...new Set([...entry.classes, ...classes])];
    }
  }

  for (const entry of exportsMap.values()) {
    entry.classes.sort((a, b) => a.localeCompare(b));
  }

  onTiming?.("total", performance.now() - totalStart);

  return Object.fromEntries(
    [...exportsMap].sort((a, b) => a[0].localeCompare(b[0])),
  );
}
