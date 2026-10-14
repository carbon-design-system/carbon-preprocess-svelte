import type { Expression } from "sveast/walk";
import type { Node } from "./ast";
import {
  appScope,
  collectSourceUsage,
  collectSvelteUsage,
  indexAppComponents,
  isAppComponent,
  type ModuleConstants,
  type ModuleUsage,
} from "./call-sites";
import { buildComponentModel, type ComponentModel } from "./component-model";
import { createScope, evaluate, type Scope } from "./evaluate";
import type { Library } from "./library";
import {
  addCallSite,
  type CallSite,
  type ComponentUsage,
  newComponentUsage,
} from "./usage";
import { isObject, UNKNOWN, type Value } from "./values";

const MODULE_FILE = /\.[cm]?[jt]s$/;
const TS_FILE = /\.[cm]?ts$/;
const SCRIPT_END = /<\/script/i;

/**
 * The exported constants of the app's own JS/TS modules, read with the
 * component model (as a module script). Only strings, numbers, booleans,
 * `null` and `undefined`: an importer could change an exported object.
 * Each module is read the first time an app component imports from it.
 */
function moduleConstants(
  modules: ReadonlyArray<{ file: string; code: string }>,
): ModuleConstants {
  const sources = new Map<string, string>();
  for (const { file, code } of modules) {
    if (MODULE_FILE.test(file) && code.includes("export")) {
      sources.set(file, code);
    }
  }
  const constants = new Map<string, ReadonlyMap<string, Value> | undefined>();
  return (file) => {
    if (!constants.has(file)) {
      const code = sources.get(file);
      constants.set(
        file,
        code === undefined ? undefined : readConstants(file, code),
      );
    }
    return constants.get(file);
  };
}

function readConstants(
  file: string,
  code: string,
): ReadonlyMap<string, Value> | undefined {
  if (SCRIPT_END.test(code)) return undefined;
  let model: ComponentModel;
  try {
    const lang = TS_FILE.test(file) ? ' lang="ts"' : "";
    model = buildComponentModel(
      `<script context="module"${lang}>\n${code}\n</script>`,
      file,
    );
  } catch {
    return undefined;
  }
  const usage = newComponentUsage();
  usage.open = true;
  const scope = createScope(model, usage, () => UNKNOWN);
  const values = new Map<string, Value>();
  for (const [exported, local] of exportedNames(model)) {
    const value = evaluate(
      { type: "Identifier", name: local } as Expression,
      scope,
    );
    if (value === UNKNOWN || [...value].some(isObject)) continue;
    values.set(exported, value);
  }
  return values.size > 0 ? values : undefined;
}

/** `[exported name, local name]` for each `export const`/`export { … }`. */
function exportedNames(model: ComponentModel): Array<[string, string]> {
  const names: Array<[string, string]> = [];
  for (const statement of (model.ast.module?.content.body ?? []) as Node[]) {
    if (statement.type !== "ExportNamedDeclaration" || statement.source) {
      continue;
    }
    const { declaration } = statement;
    if (declaration?.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations) {
        if (declarator.id.type === "Identifier") {
          names.push([declarator.id.name, declarator.id.name]);
        }
      }
    }
    for (const specifier of statement.specifiers) {
      if (
        specifier.local.type === "Identifier" &&
        specifier.exported.type === "Identifier"
      ) {
        names.push([specifier.exported.name, specifier.local.name]);
      }
    }
  }
  return names;
}

export type AppUsage = {
  /** Every module's library call sites, ready for `analyzeUsage`. */
  modules: ModuleUsage[];
  /** Each analyzed file as first read, by path: see `readLibraryImport`. */
  read: ReadonlyMap<string, ModuleUsage>;
  /**
   * App components whose props were read from their call sites alone:
   * sound only if nothing outside the analyzed files renders them, which
   * the build plugins check against the module graph.
   */
  closed: Set<string>;
  /**
   * The scope closed app component `file` was last read in, with its
   * merged usage; `undefined` for one that isn't closed or couldn't be
   * modeled.
   */
  scopeFor(file: string): Scope | undefined;
};

/**
 * Follows props through the app's own components. A wrapper like
 * `<Card tone="danger">` that passes `kind={tone}` to a library `Button` is
 * evaluated with the props its own call sites pass, until no wrapper's
 * usage grows; then each one's library call sites are known as precisely as
 * its callers make them.
 *
 * An app component renders with any props when the analyzed files never
 * import it (a route, an entry the framework mounts), a script uses it,
 * or a file imports it dynamically or through an alias.
 */
export function collectAppUsage(
  files: Iterable<{ file: string; code: string }>,
  library: Library,
  /** Aliased `.svelte` imports the bundler resolved; see `AppComponents`. */
  resolved?: ReadonlyMap<string, string>,
): AppUsage {
  const sources = new Map<string, string>();
  const others: Array<{ file: string; code: string }> = [];
  for (const entry of files) {
    if (entry.file.endsWith(".svelte")) sources.set(entry.file, entry.code);
    else others.push(entry);
  }
  const apps = indexAppComponents(sources.keys(), resolved);

  const models = new Map<string, ComponentModel | null>();
  const modelOf = (key: string): ComponentModel | null => {
    if (!models.has(key)) {
      let model: ComponentModel | null = null;
      try {
        model = buildComponentModel(sources.get(key) ?? "", key);
      } catch {
        // Unparseable: its sites still come from its imports.
      }
      models.set(key, model);
    }
    return models.get(key) ?? null;
  };
  const constants = moduleConstants(others);
  const collect = (key: string, usage?: ComponentUsage) =>
    collectSvelteUsage(sources.get(key) ?? "", key, library, {
      apps,
      usage,
      model: modelOf(key) ?? undefined,
      constants,
    });

  // Which app components some analyzed file refers to at all; the rest are
  // rendered by something the analysis can't see.
  const statics = others.map(({ file, code }) =>
    collectSourceUsage(code, file, library, apps),
  );
  const referenced = new Set<string>();
  const read = new Map<string, ModuleUsage>();
  let openApps = false;
  for (const module of [
    ...statics,
    ...[...sources.keys()].map((key) => collect(key)),
  ]) {
    if (module.file) read.set(module.file, module);
    openApps ||= module.openApps === true;
    for (const site of module.sites) {
      if (isAppComponent(site.component)) referenced.add(site.component);
    }
  }

  const usages = new Map<string, ComponentUsage>();
  const latest = new Map<string, ModuleUsage>();
  const queue = new Set<string>();
  const enqueue = (site: CallSite) => {
    if (!sources.has(site.component)) return;
    let usage = usages.get(site.component);
    if (!usage) {
      usage = newComponentUsage();
      usages.set(site.component, usage);
    }
    const merged = openApps ? { ...site, open: true } : site;
    const propNames = modelOf(site.component)?.propNames.values() ?? [];
    if (addCallSite(usage, merged, propNames, library.svelteMajor)) {
      queue.add(site.component);
    }
  };

  for (const key of sources.keys()) {
    if (openApps || !referenced.has(key)) {
      enqueue({ component: key, open: true, props: new Map(), slots: null });
    }
  }
  for (const module of statics) {
    for (const site of module.sites) {
      if (isAppComponent(site.component)) enqueue(site);
    }
  }
  for (const key of queue) {
    queue.delete(key);
    const module = collect(key, usages.get(key));
    latest.set(key, module);
    for (const site of module.sites) {
      if (isAppComponent(site.component)) enqueue(site);
    }
  }

  const libraryOnly = (module: ModuleUsage): ModuleUsage => ({
    ...module,
    sites: module.sites.filter((site) => !isAppComponent(site.component)),
  });
  const closed = new Set(
    [...usages].filter(([, usage]) => !usage.open).map(([key]) => key),
  );
  return {
    modules: [...statics, ...latest.values()].map(libraryOnly),
    read,
    closed,
    scopeFor(file) {
      const usage = usages.get(file);
      const model = modelOf(file);
      return closed.has(file) && usage && model
        ? appScope(model, file, usage, constants, library)
        : undefined;
    },
  };
}
