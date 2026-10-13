import { readFileSync } from "node:fs";
import path from "node:path";
import { listJsAndSvelteFiles } from "../indexer/list-files";
import { carbonSignature } from "../indexer/resolve-carbon-root";
import { collectCarbonTokens } from "../plugins/scan-content";
import type { CarbonComponents, ModuleUsage } from "./call-sites";
import { type ComponentModel, loadComponentModel } from "./component-model";
import { type ContextResolver, createScope, type Scope } from "./evaluate";
import { walkLive } from "./live-walk";
import {
  addCallSite,
  type CallSite,
  type ComponentUsage,
  newComponentUsage,
} from "./usage";
import { possible, UNDEFINED, UNKNOWN, type Value } from "./values";

export type PropAwareOptions = {
  /** Components that keep every variant's styles, as without `propAware`. */
  exclude?: string[];
  /**
   * Values for props the analysis can't read (`kind={row.kind}`), by
   * component name then prop name. Used at call sites where the prop's
   * value is an expression; sites that spread props still keep everything.
   */
  assume?: Record<
    string,
    Record<string, Array<string | number | boolean | null>>
  >;
};

export type UsageAnalysis = {
  /** Carbon module keys that can render. */
  liveComponents: Set<string>;
  /** Merged call sites per Carbon module key. */
  usages: Map<string, ComponentUsage>;
  /**
   * Whether no rendered component can apply `cls`: `.bx--btn--danger` when
   * no button is danger, and every class of a component that can't render.
   */
  isPruned(cls: string): boolean;
  /**
   * The scope `key` was last walked in: its merged usage and the final
   * context facts. `undefined` for a component that can't render.
   */
  scopeFor(key: string): Scope | undefined;
};

type CarbonSources = {
  /** Classes and prefixes Carbon's `.js` modules name; never pruned. */
  scriptTokens: Set<string>;
  /** `setContext` keys `.svelte` components pass (see `contextKey`). */
  componentContexts: Set<string>;
  /** `setContext` keys `.js` modules pass as literals. */
  scriptContexts: Set<string>;
  /** A `.js` module passes `setContext` a key that isn't a literal. */
  unknownScriptContext: boolean;
};

const SET_CONTEXT = /setContext\(\s*["']([^"']+)["']/g;
/** A `setContext` call whose key isn't a lone string literal. */
const SET_OTHER_CONTEXT = /setContext\(\s*(?!["'][^"']*["']\s*[,)])/;
const carbonSourcesCache = new Map<
  string,
  { signature: string; sources: CarbonSources }
>();

/** Read once per Carbon, and again when it changes (see `carbonSignature`). */
async function readCarbonSources(carbonRoot: string): Promise<CarbonSources> {
  const carbonSrc = path.join(carbonRoot, "src");
  const signature = await carbonSignature(carbonRoot);
  const cached = carbonSourcesCache.get(carbonSrc);
  if (cached?.signature === signature) return cached.sources;

  const sources: CarbonSources = {
    scriptTokens: new Set(),
    componentContexts: new Set(),
    scriptContexts: new Set(),
    unknownScriptContext: false,
  };
  for (const file of await listJsAndSvelteFiles(carbonSrc)) {
    if (file.startsWith("icons/")) continue;
    const code = readFileSync(path.join(carbonSrc, file), "utf8");
    const isScript = file.endsWith(".js");
    if (isScript) collectCarbonTokens(code, sources.scriptTokens);
    for (const match of code.matchAll(SET_CONTEXT)) {
      (isScript ? sources.scriptContexts : sources.componentContexts).add(
        match[1],
      );
    }
    if (!SET_OTHER_CONTEXT.test(code)) continue;
    // A component's own model reads keys imported as constants; any it
    // can't read make it provide every key (`providesUnknownContext`).
    if (isScript) sources.unknownScriptContext = true;
    else {
      for (const key of loadComponentModel(carbonSrc, file).providedContexts) {
        sources.componentContexts.add(key);
      }
    }
  }
  carbonSourcesCache.set(carbonSrc, { signature, sources });
  return sources;
}

type Pass = {
  usages: Map<string, ComponentUsage>;
  /** The context resolver of the final iteration. */
  resolver: ContextResolver;
  classes: Set<string>;
  prefixes: Set<string>;
};

/**
 * Walks every component reachable from `roots` until no usage grows: a
 * component's child call sites feed the child's usage, which may make more
 * of the child live, and so on.
 */
function runPass(
  modelOf: (key: string) => ComponentModel,
  roots: CallSite[],
  context: (provided: Set<string>, providesUnknown: boolean) => ContextResolver,
  excluded: ReadonlySet<string>,
): Pass {
  let provided = new Set<string>();
  // A rendered component passes `setContext` a key the analysis can't read.
  let providesUnknown = false;
  for (;;) {
    const usages = new Map<string, ComponentUsage>();
    const live = new Map<string, ReturnType<typeof walkLive>>();
    // A component queued twice is walked once, with its usage as it is then.
    const queue = new Set<string>();
    const resolver = context(provided, providesUnknown);

    const enqueue = (site: CallSite) => {
      const model = modelOf(site.component);
      let usage = usages.get(site.component);
      if (!usage) {
        usage = newComponentUsage();
        usages.set(site.component, usage);
      }
      // Excluded wherever it renders, Carbon's own call sites included.
      if (excluded.has(site.component) && !site.open) {
        site = { ...site, open: true, reason: "excluded" };
      }
      if (addCallSite(usage, site, model.propNames.values())) {
        queue.add(site.component);
      }
    };

    for (const site of roots) enqueue(site);
    for (const key of queue) {
      queue.delete(key);
      const model = modelOf(key);
      const usage = usages.get(key);
      if (!usage) continue;
      const result = walkLive(createScope(model, usage, resolver));
      live.set(key, result);
      for (const site of result.childSites) enqueue(site);
    }

    // `getContext` reads `undefined` unless a rendered component provides
    // it. Rendering more can provide more, so repeat until that settles.
    const next = new Set(provided);
    let nextUnknown: boolean = providesUnknown;
    for (const key of usages.keys()) {
      const model = modelOf(key);
      for (const contextKey of model.providedContexts) next.add(contextKey);
      nextUnknown ||= model.providesUnknownContext;
    }
    if (next.size === provided.size && nextUnknown === providesUnknown) {
      const classes = new Set<string>();
      const prefixes = new Set<string>();
      for (const result of live.values()) {
        for (const cls of result.classes) classes.add(cls);
        for (const prefix of result.prefixes) prefixes.add(prefix);
      }
      return { usages, resolver, classes, prefixes };
    }
    provided = next;
    providesUnknown = nextUnknown;
  }
}

function startsWithAny(cls: string, prefixes: Iterable<string>): boolean {
  for (const prefix of prefixes) if (cls.startsWith(prefix)) return true;
  return false;
}

/**
 * Which Carbon classes the app can never render, given how it calls each
 * component: every class the components it renders can't apply under the
 * app's props, unless one of Carbon's `.js` modules names it. The walk
 * collects every class literal and template prefix in what renders, so a
 * class it doesn't see can't be applied: one only a dead branch applies,
 * or one of a component that never renders at all.
 *
 * Throws if a component can't be modeled; callers fall back to pruning
 * without props.
 */
export async function analyzeUsage(input: {
  carbonRoot: string;
  carbon: CarbonComponents;
  /** Carbon module keys in the bundle. */
  bundled: Iterable<string>;
  modules: Iterable<ModuleUsage>;
  options?: PropAwareOptions;
}): Promise<UsageAnalysis> {
  const carbonSrc = path.join(input.carbonRoot, "src");
  const sources = await readCarbonSources(input.carbonRoot);
  const bundled = [...input.bundled];
  const options = input.options ?? {};
  // Each model once per analysis: `loadComponentModel` checks the file's
  // mtime, and the passes ask for the same models thousands of times.
  const models = new Map<string, ComponentModel>();
  const modelOf = (key: string): ComponentModel => {
    let model = models.get(key);
    if (!model) {
      model = loadComponentModel(carbonSrc, key);
      models.set(key, model);
    }
    return model;
  };

  const excluded = new Set(
    (options.exclude ?? []).flatMap((name) => {
      const key = input.carbon.get(name);
      return key ? [key] : [];
    }),
  );
  const assumed = new Map<string, Map<string, Value>>();
  for (const [name, props] of Object.entries(options.assume ?? {})) {
    const key = input.carbon.get(name);
    if (!key) continue;
    assumed.set(
      key,
      new Map(
        Object.entries(props).map(([prop, values]) => [
          prop,
          possible(...values),
        ]),
      ),
    );
  }

  const roots: CallSite[] = [];
  const appContexts = new Set<string>();
  let appProvidesUnknown = false;
  let openAll = false;
  for (const module of input.modules) {
    openAll ||= module.openAll;
    for (const key of module.providedContexts) appContexts.add(key);
    appProvidesUnknown ||= module.providesUnknownContext === true;
    for (const site of module.sites) {
      const assumptions = assumed.get(site.component);
      if (assumptions && !site.open) {
        const props = new Map(site.props);
        for (const [prop, value] of assumptions) {
          if (props.get(prop) === UNKNOWN) props.set(prop, value);
        }
        roots.push({ ...site, props });
      } else {
        roots.push(site);
      }
    }
  }
  if (openAll) {
    for (const key of bundled) {
      roots.push({ component: key, open: true, props: new Map(), slots: null });
    }
  }

  const precise = runPass(
    modelOf,
    roots,
    (provided, providesUnknown) => (key) =>
      providesUnknown ||
      appProvidesUnknown ||
      sources.unknownScriptContext ||
      provided.has(key) ||
      appContexts.has(key) ||
      sources.scriptContexts.has(key) ||
      // A key set some way this scan can't see (a constant, a helper).
      !sources.componentContexts.has(key)
        ? UNKNOWN
        : UNDEFINED,
    excluded,
  );

  const scriptPrefixes = [...sources.scriptTokens].filter((token) =>
    token.endsWith("-"),
  );
  const verdicts = new Map<string, boolean>();
  const isPruned = (cls: string): boolean => {
    let verdict = verdicts.get(cls);
    if (verdict === undefined) {
      // Not only the classes a bundled component could apply under other
      // props: the index also lists, for a component, classes its CSS is
      // written against (`.bx--date-picker` for every input DatePicker can
      // wrap), and those can't render unless their own component is live.
      verdict =
        !precise.classes.has(cls) &&
        !startsWithAny(cls, precise.prefixes) &&
        !sources.scriptTokens.has(cls) &&
        !startsWithAny(cls, scriptPrefixes);
      verdicts.set(cls, verdict);
    }
    return verdict;
  };

  return {
    liveComponents: new Set(precise.usages.keys()),
    usages: precise.usages,
    isPruned,
    scopeFor(key) {
      const usage = precise.usages.get(key);
      return usage
        ? createScope(modelOf(key), usage, precise.resolver)
        : undefined;
    },
  };
}
