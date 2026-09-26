import { readFile } from "node:fs/promises";
import path from "node:path";
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
import {
  type ClassGate,
  type ClassVariant,
  extractFromSvelte,
} from "./extract-selectors";
import { listJsAndSvelteFiles } from "./list-files";
import { mergeSubComponentClasses } from "./merge-sub-component-classes";
import { resolveCarbonRoot } from "./resolve-carbon-root";
import { loadSvelteParser } from "./svelte-parser";
import { walk } from "./walk";

export { resolveCarbonRoot } from "./resolve-carbon-root";

const RELATIVE_SOURCE_PREFIX = /^\.\//;

export type {
  ClassGate,
  ClassVariant,
  GateCondition,
  PropDefault,
} from "./extract-selectors";

export type ComponentIndex = Record<
  string,
  {
    path: string;
    classes: string[];
    /**
     * Prefixes in `classes` this component only completes with a prop's
     * value. Omitted when there are none.
     */
    variants?: ClassVariant[];
    /**
     * Classes in `classes` this component only renders under a condition
     * on its own props. Omitted when there are none.
     */
    gates?: ClassGate[];
  }
>;

/**
 * Builds the component index (name -> source path + owned CSS classes)
 * directly from an installed `carbon-components-svelte`. Called at build
 * time against the consuming project's install; `./load-index.ts` caches
 * the result on disk.
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
  const index_js = path.join(carbon_src, "index.js");
  const [index_file, parse] = await Promise.all([
    readFile(index_js, "utf8"),
    loadSvelteParser(options?.projectRoot),
  ]);

  type Identifier = string;
  type IdentifierValue = {
    path: string;
    classes: string[];
    variants?: ClassVariant[];
    gates?: ClassGate[];
  };

  const exports_map = new Map<Identifier, null | IdentifierValue>();
  const internal_components = new Map<Identifier, null | IdentifierValue>();
  const sub_components = new Map<Identifier, Identifier[]>();
  const slot_wrapper_classes = new Map<Identifier, string[]>();
  const module_to_component = new Map<string, string>();
  // exported component -> variants its own file declares, before vetting.
  const own_variants = new Map<Identifier, ClassVariant[]>();
  const own_gates = new Map<Identifier, ClassGate[]>();
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

    if (exports_map.has(moduleName)) {
      exports_map.set(moduleName, map);
      module_to_component.set(moduleKey, moduleName);
      if (extracted && extracted.variants.length > 0) {
        own_variants.set(moduleName, extracted.variants);
      }
      if (extracted && extracted.gates.length > 0) {
        own_gates.set(moduleName, extracted.gates);
      }
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

  // Vet variants and gates before the runtime/CSS classes land, so they can
  // be told apart from the markup classes they would otherwise blend into.
  // A class (or prefix) another source also contributes may be rendered
  // without the prop, so it keeps its plain allowlist entry.
  for (const component of new Set([
    ...own_variants.keys(),
    ...own_gates.keys(),
  ])) {
    const entry = exports_map.get(component);
    if (
      !entry ||
      !onlyRenderedInMarkup(
        component,
        entry.path,
        moduleGraph.importsByModule,
        extractedByFile,
      )
    ) {
      continue;
    }

    const other_sources = new Set([
      ...(sub_components.get(component) ?? []).flatMap(
        (child) => all_components.get(child)?.classes ?? [],
      ),
      ...(runtime_classes.get(component) ?? []),
      ...(css_context.get(component) ?? []),
      ...(css_orphans.get(component) ?? []),
    ]);
    const variants = (own_variants.get(component) ?? []).filter(
      (variant) => !other_sources.has(variant.prefix),
    );
    const gates = (own_gates.get(component) ?? []).filter(
      (gate) => !other_sources.has(gate.class),
    );
    if (variants.length > 0) entry.variants = variants;
    if (gates.length > 0) entry.gates = gates;
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

  emit("total", performance.now() - scanStart);

  return components;
}

/**
 * Whether every Carbon module importing `component` renders it as
 * `<Component>`. Those parents absorb its classes whole (prefixes
 * included) through `mergeSubComponentClasses`, so a variant only narrows
 * what the component contributes when an app renders it directly. A module
 * that imports it any other way (a JS helper mounting it, an aliased
 * import) could pass values nothing scans for.
 */
function onlyRenderedInMarkup(
  component: string,
  componentPath: string,
  importsByModule: Map<string, string[]>,
  extractedByFile: Map<string, { components: string[] }>,
): boolean {
  const moduleKey = componentPath.slice(
    `${CarbonSvelte.Components}/src/`.length,
  );
  const dir = path.posix.dirname(moduleKey);

  for (const [importer, imports] of importsByModule) {
    if (importer === moduleKey) continue;

    const importsComponent = imports.some(
      (spec) =>
        spec === moduleKey ||
        spec === `${dir}.js` ||
        spec === `${dir}/index.js`,
    );
    if (
      importsComponent &&
      !extractedByFile.get(importer)?.components.includes(component)
    ) {
      return false;
    }
  }

  return true;
}
