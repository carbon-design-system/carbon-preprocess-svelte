import {
  type CarbonComponents,
  collectSourceUsage,
  collectSvelteUsage,
  indexAppComponents,
  isAppComponent,
  type ModuleUsage,
} from "./call-sites";
import { buildComponentModel, type ComponentModel } from "./component-model";
import {
  addCallSite,
  type CallSite,
  type ComponentUsage,
  newComponentUsage,
} from "./usage";

export type AppUsage = {
  /** Every module's Carbon call sites, ready for `analyzeUsage`. */
  modules: ModuleUsage[];
  /**
   * App components whose props were read from their call sites alone:
   * sound only if nothing outside the analyzed files renders them, which
   * the build plugins check against the module graph.
   */
  closed: Set<string>;
};

/**
 * Follows props through the app's own components. A wrapper like
 * `<Card tone="danger">` that passes `kind={tone}` to a Carbon `Button` is
 * evaluated with the props its own call sites pass, until no wrapper's
 * usage grows; then each one's Carbon call sites are known as precisely as
 * its callers make them.
 *
 * An app component renders with any props when the analyzed files never
 * import it (a route, an entry the framework mounts), a script uses it,
 * or a file imports it dynamically or through an alias.
 */
export function collectAppUsage(
  files: Iterable<{ file: string; code: string }>,
  carbon: CarbonComponents,
): AppUsage {
  const sources = new Map<string, string>();
  const others: Array<{ file: string; code: string }> = [];
  for (const entry of files) {
    if (entry.file.endsWith(".svelte")) sources.set(entry.file, entry.code);
    else others.push(entry);
  }
  const apps = indexAppComponents(sources.keys());

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
  const collect = (key: string, usage?: ComponentUsage) =>
    collectSvelteUsage(sources.get(key) ?? "", key, carbon, {
      apps,
      usage,
      model: modelOf(key) ?? undefined,
    });

  // Which app components some analyzed file refers to at all; the rest are
  // rendered by something the analysis can't see.
  const statics = others.map(({ file, code }) =>
    collectSourceUsage(code, file, carbon, apps),
  );
  const referenced = new Set<string>();
  let openApps = false;
  for (const module of [
    ...statics,
    ...[...sources.keys()].map((key) => collect(key)),
  ]) {
    openApps ||= module.openApps === true;
    for (const site of module.sites) {
      if (isAppComponent(site.component)) referenced.add(site.component);
    }
  }

  const usages = new Map<string, ComponentUsage>();
  const latest = new Map<string, ModuleUsage>();
  const queue: string[] = [];
  const enqueue = (site: CallSite) => {
    if (!sources.has(site.component)) return;
    let usage = usages.get(site.component);
    if (!usage) {
      usage = newComponentUsage();
      usages.set(site.component, usage);
    }
    const merged = openApps ? { ...site, open: true } : site;
    const propNames = modelOf(site.component)?.propNames.values() ?? [];
    if (addCallSite(usage, merged, propNames)) queue.push(site.component);
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
  for (let key = queue.shift(); key; key = queue.shift()) {
    const module = collect(key, usages.get(key));
    latest.set(key, module);
    for (const site of module.sites) {
      if (isAppComponent(site.component)) enqueue(site);
    }
  }

  const carbonOnly = (module: ModuleUsage): ModuleUsage => ({
    ...module,
    sites: module.sites.filter((site) => !isAppComponent(site.component)),
  });
  return {
    modules: [...statics, ...latest.values()].map(carbonOnly),
    closed: new Set(
      [...usages].filter(([, usage]) => !usage.open).map(([key]) => key),
    ),
  };
}
