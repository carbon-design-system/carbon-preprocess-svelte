import { readFile } from "node:fs/promises";
import path from "node:path";
import { walk } from "estree-walker";
import { parse } from "svelte/compiler";
import { CarbonSvelte } from "../constants";
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

const RELATIVE_SOURCE_PREFIX = /^\.\//;

export type ComponentIndex = Record<
  string,
  { path: string; classes: string[] }
>;

/**
 * Rebuilds the component index (name -> import path + owned CSS classes)
 * directly from an installed `carbon-components-svelte`. Shared core behind
 * both the maintainer's `bun run index:components` regeneration script and
 * the opt-in runtime live-index (see `./live-index.ts`), so a fix to the
 * extraction gates here benefits both.
 */
export async function buildComponentIndex(options?: {
  carbonRoot?: string;
  /**
   * Lists `.js`/`.svelte` files under the Carbon `src` directory (relative,
   * posix-separated paths). Defaults to a Node-native recursive walk.
   *
   * Multi-level sub-component class merging below is a single pass keyed off
   * this scan order, so a different (but still valid) traversal order can
   * surface a slightly different, but not less correct, set of transitively
   * inherited classes than another traversal would. The CLI regeneration
   * script (`scripts/index-components.ts`) injects a Bun `Glob`-based lister
   * to keep the committed `component-index.ts` reproducible; this only
   * matters for byte-for-byte comparison against that frozen file, not for
   * correctness of a freshly computed live index.
   */
  listFiles?: (carbonSrc: string) => Promise<string[]>;
  onTiming?: (label: string, ms: number) => void;
}): Promise<ComponentIndex> {
  const emit = options?.onTiming ?? (() => {});
  const listFiles = options?.listFiles ?? listJsAndSvelteFiles;
  const carbon_path = options?.carbonRoot ?? resolveCarbonRoot();
  const carbon_src = path.join(carbon_path, "src");
  const index_js = path.join(carbon_src, "index.js");
  const index_file = await readFile(index_js, "utf8");

  type Identifier = string;
  type IdentifierValue = { path: string; classes: string[] };

  const exports_map = new Map<Identifier, null | IdentifierValue>();
  const internal_components = new Map<Identifier, null | IdentifierValue>();
  const sub_components = new Map<Identifier, Identifier[]>();
  const slot_wrapper_classes = new Map<Identifier, string[]>();
  const module_to_component = new Map<string, string>();
  // src-relative path -> scanned entry (for re-export lookup).
  const file_entries = new Map<string, IdentifierValue>();
  // export name -> index.js re-export source (filterTreeById -> ./utils/filterTreeNodes).
  const export_sources = new Map<Identifier, string>();

  const moduleGraph: ModuleGraphCache = {
    importsByModule: new Map(),
    runtimeByModule: new Map(),
  };

  walk(parse(`<script>${index_file}</script>`), {
    enter(node) {
      if (node.type === "Identifier") {
        exports_map.set(node.name, null);
      }

      if (node.type === "ExportNamedDeclaration" && node.source) {
        for (const specifier of node.specifiers) {
          export_sources.set(specifier.exported.name, node.source.value);
        }
      }
    },
  });

  const scanStart = performance.now();
  const files = await listFiles(carbon_src);

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

    if (isSvelteFile(file)) {
      const file_path = path.join(carbon_src, file);
      // biome-ignore lint/performance/noAwaitInLoops: shared maps below are keyed by scan order (duplicate "index" module names across directories resolve last-write-wins); parallelizing would make that racy.
      const file_text = await readFile(file_path, "utf8");
      const extracted = extractFromSvelte({ code: file_text, filename: file });

      map.classes = extracted.classes;

      if (extracted.components.length > 0) {
        sub_components.set(moduleName, extracted.components);
      }

      if (extracted.slotWrappers.length > 0) {
        slot_wrapper_classes.set(moduleName, extracted.slotWrappers);
      }

      moduleGraph.importsByModule.set(moduleKey, extracted.imports);

      if (extracted.runtimeClasses.length > 0) {
        moduleGraph.runtimeByModule.set(
          moduleKey,
          new Set(extracted.runtimeClasses),
        );
      }
    }

    if (exports_map.has(moduleName)) {
      exports_map.set(moduleName, map);
      module_to_component.set(moduleKey, moduleName);
    } else if (isSvelteFile(file)) {
      internal_components.set(moduleName, map);
    }
  }

  emit("component scan", performance.now() - scanStart);

  function resolveSource(source: string): IdentifierValue | undefined {
    const base = source.replace(RELATIVE_SOURCE_PREFIX, "");
    for (const candidate of [
      base,
      `${base}.js`,
      `${base}.svelte`,
      `${base}/index.js`,
    ]) {
      const entry = file_entries.get(candidate);
      if (entry) return entry;
    }
    return undefined;
  }

  // Filename scan only catches exports named after their file (filterTreeNodes).
  // Look up sibling re-exports from index.js or optimizeImports invents *.svelte.
  for (const [name, entry] of exports_map.entries()) {
    if (entry !== null) continue;

    const source = export_sources.get(name);
    if (!source) continue;

    const resolved = resolveSource(source);
    if (resolved) {
      exports_map.set(name, {
        path: resolved.path,
        classes: [...resolved.classes],
      });
    }
  }

  const all_components = new Map(
    [...exports_map, ...internal_components].filter(
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

  const cssStart = performance.now();
  const carbon_css = await readFile(resolveCarbonCssPath(), "utf8");
  const { context: css_context, orphans: css_orphans } =
    extractCssIndexAdditions({
      componentClasses: markup_only_classes,
      slotWrapperClasses: slot_wrapper_classes,
      subComponents: sub_components,
      css: carbon_css,
    });
  emit("css index", performance.now() - cssStart);

  const runtimeStart = performance.now();
  const runtime_classes = await buildRuntimeClassMap(
    carbon_src,
    module_to_component,
    moduleGraph,
  );
  emit("runtime graph", performance.now() - runtimeStart);

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
    new Map(
      [...exports_map.entries()]
        .sort((a, b) => a.toLocaleString().localeCompare(b.toLocaleString()))
        .filter(
          (entry): entry is [Identifier, IdentifierValue] => entry[1] !== null,
        ),
    ),
  );

  emit("total", performance.now() - scanStart);

  return components;
}
