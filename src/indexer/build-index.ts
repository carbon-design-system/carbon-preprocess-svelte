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
import { loadSvelteParser } from "./svelte-parser";

export { resolveCarbonRoot } from "./resolve-carbon-root";

export type ComponentIndex = Record<
  string,
  {
    path: string;
    classes: string[];
    /**
     * A `.svelte` file the barrel doesn't export, keyed by its `src/` path.
     * Bundled only through a component that renders it.
     */
    internal?: true;
  }
>;

/**
 * Builds the component index directly from an installed
 * `carbon-components-svelte`: each name its barrel exports -> source path +
 * owned CSS classes, plus an `internal` entry for every other `.svelte`
 * file. Called at build time against the consuming project's install;
 * `./load-index.ts` caches the result on disk.
 */
export async function buildComponentIndex(options?: {
  carbonRoot?: string;
  /** Directory `svelte/compiler` is resolved from first. */
  projectRoot?: string;
  onTiming?: (label: string, ms: number) => void;
}): Promise<ComponentIndex> {
  const emit = options?.onTiming ?? (() => {});
  const carbon_path = options?.carbonRoot ?? resolveCarbonRoot();
  const carbon_src = path.join(carbon_path, "src");
  const parse = await loadSvelteParser(options?.projectRoot);

  type Identifier = string;
  type IdentifierValue = { path: string; classes: string[] };

  const exports_map = new Map<Identifier, null | IdentifierValue>();
  const internal_components = new Map<Identifier, null | IdentifierValue>();
  const sub_components = new Map<Identifier, Identifier[]>();
  const slot_wrapper_classes = new Map<Identifier, string[]>();
  const module_to_component = new Map<string, string>();
  const internal_files = new Map<string, IdentifierValue>();
  // src-relative path -> every name the barrel exports it as.
  const export_names = new Map<string, Identifier[]>();

  const moduleGraph: ModuleGraphCache = {
    importsByModule: new Map(),
    runtimeByModule: new Map(),
  };

  const src_prefix = `${CarbonSvelte.Components}/src/`;
  for (const [name, { path: importPath }] of readCarbonExports(carbon_path)) {
    const file = importPath.slice(src_prefix.length);
    export_names.set(file, [...(export_names.get(file) ?? []), name]);
  }

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
            extractFromSvelte({ code: file_text, filename: file, parse }),
          ] as const;
        }),
      )
    ).filter((entry) => entry !== null),
  );

  // Aliases get a copy of their file's entry once scanned; the first name
  // (the one matching the file name, if any) owns the entry itself.
  const aliases: Array<[Identifier, IdentifierValue]> = [];

  for (const file of files) {
    const moduleName = path.parse(file).name;
    const moduleKey = file.replace(/\\/g, "/");

    const map: IdentifierValue = {
      path: `${CarbonSvelte.Components}/src/${moduleKey}`,
      classes: [],
    };

    if (file.startsWith("icons/")) {
      if (isSvelteFile(file)) internal_files.set(moduleKey, map);
      continue;
    }

    const names = [...(export_names.get(moduleKey) ?? [])].sort(
      (a, b) => Number(b === moduleName) - Number(a === moduleName),
    );
    const componentName = names[0] ?? moduleName;

    const extracted = extractedByFile.get(file);
    if (extracted) {
      map.classes = extracted.classes;

      if (extracted.components.length > 0) {
        sub_components.set(componentName, extracted.components);
      }

      if (extracted.slotWrappers.length > 0) {
        slot_wrapper_classes.set(componentName, extracted.slotWrappers);
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

    if (names.length > 0) {
      exports_map.set(componentName, map);
      module_to_component.set(moduleKey, componentName);
      for (const alias of names.slice(1)) aliases.push([alias, map]);
    } else if (isSvelteFile(file)) {
      internal_components.set(moduleName, map);
      internal_files.set(moduleKey, map);
    }
  }

  emit("component scan", performance.now() - scanStart);

  for (const [alias, entry] of aliases) {
    exports_map.set(alias, { path: entry.path, classes: [...entry.classes] });
  }

  // Exported entries win over an internal file sharing their name.
  const all_components = new Map(
    [...internal_components, ...exports_map].filter(
      (entry): entry is [Identifier, IdentifierValue] => entry[1] !== null,
    ),
  );

  mergeSubComponentClasses(sub_components, all_components);

  const markup_only_classes = new Map<string, Set<string>>();

  for (const [name, entry] of exports_map.entries()) {
    if (entry) {
      markup_only_classes.set(name, new Set(entry.classes));
    }
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
          parse,
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
    if (entry) {
      entry.classes.sort((a, b) => a.localeCompare(b));
    }
  }

  const components: ComponentIndex = Object.fromEntries(
    [...exports_map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .filter(
        (entry): entry is [Identifier, IdentifierValue] => entry[1] !== null,
      ),
  );

  for (const [file, entry] of [...internal_files].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    components[file] = {
      path: entry.path,
      classes: [...entry.classes].sort((a, b) => a.localeCompare(b)),
      internal: true,
    };
  }

  emit("total", performance.now() - scanStart);

  return components;
}
