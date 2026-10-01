import { readFile } from "node:fs/promises";
import path from "node:path";
import { CarbonSvelte } from "../constants";
import { readCarbonExports } from "../preprocessors/carbon-exports";
import { isSvelteFile } from "../utils";
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

export type ComponentIndex = Record<
  string,
  { path: string; classes: string[] }
>;

/**
 * Builds the component index (name -> source path + owned CSS classes)
 * directly from an installed `carbon-components-svelte`. Called at build
 * time against the consuming project's install; `./load-index.ts` caches
 * the result on disk.
 */
export async function buildComponentIndex(options?: {
  carbonRoot?: string;
  onTiming?: (label: string, ms: number) => void;
}): Promise<ComponentIndex> {
  const emit = options?.onTiming ?? (() => {});
  const carbon_path = options?.carbonRoot ?? resolveCarbonRoot();
  const carbon_src = path.join(carbon_path, "src");
  // export name -> its defining module, src-relative (Button -> Button/Button.svelte).
  const exported_modules = new Map<string, string>();
  for (const [name, target] of readCarbonExports(carbon_path)) {
    exported_modules.set(name, target.path.slice(SRC_PREFIX.length));
  }
  const exported_keys = new Set(exported_modules.values());

  type Identifier = string;
  type IdentifierValue = { path: string; classes: string[] };

  const exports_map = new Map<Identifier, IdentifierValue>();
  const internal_components = new Map<Identifier, IdentifierValue>();
  const sub_components = new Map<Identifier, Identifier[]>();
  const slot_wrapper_classes = new Map<Identifier, string[]>();
  const module_to_component = new Map<string, string>();
  // src-relative path -> scanned entry.
  const file_entries = new Map<string, IdentifierValue>();

  const moduleGraph: ModuleGraphCache = {
    importsByModule: new Map(),
    runtimeByModule: new Map(),
  };

  const scanStart = performance.now();
  const files = await listJsAndSvelteFiles(carbon_src);
  moduleGraph.files = new Set(files);

  const extractedByFile = new Map<string, ReturnType<typeof extractFromSvelte>>(
    (
      await Promise.all(
        files.map(async (file) => {
          if (file.startsWith("icons/") || !isSvelteFile(file)) {
            return null;
          }
          const file_text = await readFile(path.join(carbon_src, file), "utf8");
          return [
            file,
            extractFromSvelte({ code: file_text, filename: file }),
          ] as const;
        }),
      )
    ).filter((entry) => entry !== null),
  );

  for (const file of files) {
    if (file.startsWith("icons/")) {
      continue;
    }

    const moduleName = path.parse(file).name;
    const moduleKey = file.replace(/\\/g, "/");

    const map: IdentifierValue = {
      path: `${CarbonSvelte.Components}/src/${file}`,
      classes: [],
    };

    file_entries.set(moduleKey, map);

    const extracted = extractedByFile.get(file);
    if (extracted) {
      map.classes = extracted.classes;

      if (extracted.components.length > 0) {
        sub_components.set(moduleName, extracted.components);
      }

      if (extracted.slotWrappers.length > 0) {
        slot_wrapper_classes.set(moduleName, extracted.slotWrappers);
      }

      moduleGraph.importsByModule.set(moduleKey, extracted.imports);

      // Module-script classes travel with imports, so a component that
      // imports a hoisted constant from another component gets its classes.
      const graphClasses = [
        ...extracted.runtimeClasses,
        ...extracted.moduleClasses,
      ];
      if (graphClasses.length > 0) {
        moduleGraph.runtimeByModule.set(moduleKey, new Set(graphClasses));
      }
    }

    if (!exported_keys.has(moduleKey) && isSvelteFile(file)) {
      internal_components.set(moduleName, map);
    }
  }

  for (const [name, moduleKey] of exported_modules) {
    const entry = file_entries.get(moduleKey);
    if (!entry) continue;
    // A copy: aliases of one module merge classes independently.
    exports_map.set(name, { path: entry.path, classes: [...entry.classes] });
    module_to_component.set(moduleKey, name);
  }

  emit("component scan", performance.now() - scanStart);

  const all_components = new Map([...exports_map, ...internal_components]);

  mergeSubComponentClasses(sub_components, all_components);

  const markup_only_classes = new Map<string, Set<string>>();

  for (const [name, entry] of exports_map) {
    markup_only_classes.set(name, new Set(entry.classes));
  }

  const [{ context: css_context, orphans: css_orphans }, runtime_classes] =
    await Promise.all([
      (async () => {
        const cssStart = performance.now();
        const carbon_css = await readFile(
          resolveCarbonCssPath(carbon_path),
          "utf8",
        );
        const additions = extractCssIndexAdditions({
          componentClasses: markup_only_classes,
          slotWrapperClasses: slot_wrapper_classes,
          subComponents: sub_components,
          css: carbon_css,
        });
        emit("css index", performance.now() - cssStart);
        return additions;
      })(),
      (async () => {
        const runtimeStart = performance.now();
        const runtime = await buildRuntimeClassMap(
          carbon_src,
          module_to_component,
          moduleGraph,
        );
        emit("runtime graph", performance.now() - runtimeStart);
        return runtime;
      })(),
    ]);

  function mergeClasses(component: string, classes: Iterable<string>): void {
    const entry = exports_map.get(component);
    if (!entry) {
      return;
    }
    entry.classes = [...new Set([...entry.classes, ...classes])];
  }

  for (const [component, classes] of runtime_classes.entries()) {
    mergeClasses(component, classes);
  }

  for (const [component, classes] of css_context.entries()) {
    mergeClasses(component, classes);
  }

  for (const [component, classes] of css_orphans.entries()) {
    mergeClasses(component, classes);
  }

  for (const entry of exports_map.values()) {
    entry.classes.sort((a, b) => a.localeCompare(b));
  }

  const components: ComponentIndex = Object.fromEntries(
    [...exports_map].sort((a, b) => a[0].localeCompare(b[0])),
  );

  emit("total", performance.now() - scanStart);

  return components;
}
