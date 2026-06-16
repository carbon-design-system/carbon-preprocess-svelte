import path from "node:path";
import { Glob } from "bun";
import { walk } from "estree-walker";
import { parse } from "svelte/compiler";
import { CarbonSvelte } from "../src/constants";
import { isSvelteFile } from "../src/utils";
import {
  extractCssIndexAdditions,
  resolveCarbonCssPath,
} from "./extract-css-context";
import {
  buildRuntimeClassMap,
  type ModuleGraphCache,
} from "./extract-runtime-classes";
import { extractFromSvelte } from "./extract-selectors";

/**
 * Proven exceptions when automation misses on a Carbon bump. Prefer updating
 * extract-runtime-classes / extract-css-context gates before adding here.
 */
const MANUAL_OVERRIDES: Record<string, string[]> = {};

const debugIndex = process.env.DEBUG_INDEX === "1";
const RELATIVE_SOURCE_PREFIX = /^\.\//;

function logTiming(label: string, start: number): void {
  if (debugIndex) {
    console.log(
      `[index] ${label}: ${(performance.now() - start).toFixed(0)}ms`,
    );
  }
}

const carbon_path = path.join("node_modules", CarbonSvelte.Components);
const carbon_src = path.join(carbon_path, "src");
const index_js = path.join(carbon_path, "src/index.js");
const index_file = await Bun.file(index_js).text();

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
const files = new Glob("**/*.{js,svelte}").scan(carbon_src);

for await (const file of files) {
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
    const file_text = await Bun.file(file_path).text();
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

logTiming("component scan", scanStart);

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

for (const [parent, children] of sub_components.entries()) {
  const parent_map = exports_map.get(parent);

  if (parent_map) {
    const sub_classes = children.flatMap((component) => {
      if (exports_map.has(component)) {
        return exports_map.get(component)?.classes ?? [];
      }
      if (internal_components.has(component)) {
        return internal_components.get(component)?.classes ?? [];
      }

      return [];
    });

    if (sub_classes.length > 0) {
      parent_map.classes = [
        ...new Set([...parent_map.classes, ...sub_classes]),
      ];
    }
  }
}

const markup_only_classes = new Map<string, Set<string>>();

for (const [name, entry] of exports_map.entries()) {
  if (entry) {
    markup_only_classes.set(name, new Set(entry.classes));
  }
}

const cssStart = performance.now();
const carbon_css = await Bun.file(resolveCarbonCssPath()).text();
const { context: css_context, orphans: css_orphans } = extractCssIndexAdditions(
  {
    componentClasses: markup_only_classes,
    slotWrapperClasses: slot_wrapper_classes,
    subComponents: sub_components,
    css: carbon_css,
  },
);
logTiming("css index", cssStart);

const runtimeStart = performance.now();
const runtime_classes = await buildRuntimeClassMap(
  carbon_src,
  module_to_component,
  moduleGraph,
);
logTiming("runtime graph", runtimeStart);

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

for (const [identifier, classes] of Object.entries(MANUAL_OVERRIDES)) {
  mergeClasses(identifier, classes);
}

for (const entry of exports_map.values()) {
  if (entry) {
    entry.classes.sort((a, b) => a.localeCompare(b));
  }
}

const components = Object.fromEntries(
  new Map(
    [...exports_map.entries()]
      .sort((a, b) => a.toLocaleString().localeCompare(b.toLocaleString()))
      .filter(([_, value]) => value !== null),
  ),
);

const isBuild = process.env.BUILD === "true";
const jsonString = isBuild
  ? JSON.stringify(components)
  : JSON.stringify(components, null, 2);

await Bun.write(
  "src/component-index.ts",
  `// @generated
// This file was automatically generated and should not be edited.
// @see scripts/index-components.ts

export const components: Record<string, { path: string; classes: string[]; }> = Object.freeze(${jsonString});\n`,
);

logTiming("total", scanStart);
