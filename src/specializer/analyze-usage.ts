import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ModuleUsage } from "./call-sites";
import {
  type ComponentModel,
  loadComponentModel,
  type MirroredStore,
  recheckScriptModels,
} from "./component-model";
import {
  type ContextResolver,
  createScope,
  evaluate,
  type Scope,
} from "./evaluate";
import type { Library } from "./library";
import { listJsAndSvelteFiles } from "./list-files";
import { type LiveResult, walkLive } from "./live-walk";
import { packageSignature } from "./package";
import {
  addCallSite,
  type CallSite,
  type ComponentUsage,
  checkTarget,
  newComponentUsage,
} from "./usage";
import {
  join,
  possible,
  sameValue,
  shape,
  storeOf,
  UNDEFINED,
  UNKNOWN,
  type Value,
} from "./values";

export type UsageOptions = {
  /** Components that keep every variant, as if rendered with any props. */
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
  /** Library module keys that can render. */
  liveComponents: Set<string>;
  /** Merged call sites per library module key. */
  usages: Map<string, ComponentUsage>;
  /**
   * Whether no rendered component can apply `cls`: `.x--btn--danger` when
   * no button is danger, and every class of a component that can't render.
   */
  isPruned(cls: string): boolean;
  /**
   * The scope `key` was last walked in: its merged usage and the final
   * context facts. `undefined` for a component that can't render.
   */
  scopeFor(key: string): Scope | undefined;
};

type LibrarySources = {
  /** Classes and prefixes the library's script modules name; never pruned. */
  scriptTokens: Set<string>;
  /** `setContext` keys `.svelte` components pass (see `contextKey`). */
  componentContexts: Set<string>;
  /** `setContext` keys `.js` modules pass as literals. */
  scriptContexts: Set<string>;
  /** A `.js` module passes `setContext` a key that isn't a literal. */
  unknownScriptContext: boolean;
  /** A `.js` module reads a context, so what it does with one is unseen. */
  scriptReadsContext: boolean;
};

const SET_CONTEXT = /setContext\(\s*["']([^"']+)["']/g;
const GET_CONTEXT = /\bget(?:All)?Contexts?\(/;
/** A `setContext` call whose key isn't a lone string literal. */
const SET_OTHER_CONTEXT = /setContext\(\s*(?!["'][^"']*["']\s*[,)])/;
const librarySourcesCache = new Map<
  string,
  { signature: string; sources: LibrarySources }
>();

/** Read once per library, and again when it changes (see `packageSignature`). */
async function readLibrarySources(library: Library): Promise<LibrarySources> {
  const { src } = library;
  const signature = await packageSignature(library.root, library.spec.srcDir);
  const cached = librarySourcesCache.get(src);
  if (cached?.signature === signature) return cached.sources;

  const sources: LibrarySources = {
    scriptTokens: new Set(),
    componentContexts: new Set(),
    scriptContexts: new Set(),
    unknownScriptContext: false,
    scriptReadsContext: false,
  };
  const files = await listJsAndSvelteFiles(src);
  const codes = await Promise.all(
    files.map((file) => readFile(path.join(src, file), "utf8")),
  );
  for (const [i, file] of files.entries()) {
    const code = codes[i];
    const isScript = file.endsWith(".js");
    if (isScript) {
      library.spec.classTokens?.script(code, sources.scriptTokens);
      if (GET_CONTEXT.test(code)) sources.scriptReadsContext = true;
    }
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
      for (const key of loadComponentModel(src, file).providedContexts) {
        sources.componentContexts.add(key);
      }
    }
  }
  librarySourcesCache.set(src, { signature, sources });
  return sources;
}

/**
 * What `getContext(key)` reads when a rendered component provides `key`:
 * `undefined` (no provider above), or one of the providers' context
 * objects, with the stores they hand on that no reader can set.
 */
type ContextValues = Map<string, Value>;

/** Rounds after which context values stop flowing, so the fixpoint ends. */
const MAX_CONTEXT_ROUNDS = 16;

/**
 * The context values the components in `usages` provide, as `resolver`
 * evaluates them: a key's objects carry a `MirroredStore` property only
 * when it's read-only or no rendered component leaks that property.
 */
function contextValues(
  modelOf: (key: string) => ComponentModel,
  usages: Map<string, ComponentUsage>,
  resolver: ContextResolver,
  svelteMajor: number | undefined,
): ContextValues {
  const values: ContextValues = new Map();
  const leaks = new Map<string, Set<string>>();
  for (const key of usages.keys()) {
    const model = modelOf(key);
    if (model.readsUnknownContext) return values;
    for (const [contextKey, leaked] of model.contextLeaks) {
      const all = leaks.get(contextKey) ?? new Set<string>();
      for (const property of leaked) all.add(property);
      leaks.set(contextKey, all);
    }
  }
  const unflowable = new Set<string>();
  for (const [key, usage] of usages) {
    const model = modelOf(key);
    if (model.contextObjects.size === 0) continue;
    const scope = createScope(model, usage, resolver, { svelteMajor });
    for (const [contextKey, objects] of model.contextObjects) {
      const leaked = leaks.get(contextKey);
      if (!objects.every((object) => object !== null)) {
        unflowable.add(contextKey);
        continue;
      }
      let value = values.get(contextKey) ?? UNDEFINED;
      for (const object of objects) {
        const props = new Map<string, Value>();
        for (const [property, mirrored] of object) {
          const flows =
            mirrored &&
            (mirrored.readOnly || !(leaked?.has("*") || leaked?.has(property)));
          props.set(property, flows ? storeValue(mirrored, scope) : UNKNOWN);
        }
        value = join(value, possible(shape({ kind: "object", props })));
      }
      values.set(contextKey, value);
    }
  }
  for (const key of unflowable) values.delete(key);
  return values;
}

/** What a `MirroredStore` holds: its initial value or any of its writes. */
function storeValue(mirrored: MirroredStore, scope: Scope): Value {
  let value = mirrored.initial ? evaluate(mirrored.initial, scope) : UNDEFINED;
  for (const write of mirrored.writes) {
    value = join(value, evaluate(write, scope));
  }
  return storeOf(value);
}

function sameValues(a: ContextValues, b: ContextValues): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (!other || !sameValue(value, other)) return false;
  }
  return true;
}

/** What the rendered components provide, as one round of `runPass` reads it. */
type ProvidedContexts = {
  keys: Set<string>;
  /** A rendered component passes `setContext` a key the analysis can't read. */
  unknown: boolean;
  values: ContextValues;
};

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
  context: (provided: ProvidedContexts) => ContextResolver,
  excluded: ReadonlySet<string>,
  /** Whether stores may flow through contexts (see `contextValues`). */
  flowContexts: boolean,
  library: Library,
): Pass {
  const { svelteMajor } = library;
  let provided: ProvidedContexts = {
    keys: new Set(),
    unknown: false,
    values: new Map(),
  };
  for (let round = 0; ; round++) {
    const usages = new Map<string, ComponentUsage>();
    const live = new Map<string, LiveResult>();
    // A component queued twice is walked once, with its usage as it is then.
    const queue = new Set<string>();
    const resolver = context(provided);

    const enqueue = (site: CallSite) => {
      const model = modelOf(site.component);
      let usage = usages.get(site.component);
      if (!usage) {
        usage = newComponentUsage();
        usages.set(site.component, usage);
      }
      // Excluded wherever it renders, the library's own call sites included.
      if (excluded.has(site.component) && !site.open) {
        site = { ...site, open: true, reason: "excluded" };
      }
      site = checkTarget(site, model);
      if (addCallSite(usage, site, model.propNames.values(), svelteMajor)) {
        queue.add(site.component);
      }
    };

    for (const site of roots) enqueue(site);
    for (const key of queue) {
      queue.delete(key);
      const model = modelOf(key);
      const usage = usages.get(key);
      if (!usage) continue;
      const result = walkLive(
        createScope(model, usage, resolver, { svelteMajor }),
        library,
      );
      live.set(key, result);
      for (const site of result.childSites) enqueue(site);
    }

    // `getContext` reads `undefined` unless a rendered component provides
    // it. Rendering more can provide more, so repeat until that settles.
    const next: ProvidedContexts = {
      keys: new Set(provided.keys),
      unknown: provided.unknown,
      values:
        flowContexts && round < MAX_CONTEXT_ROUNDS
          ? contextValues(modelOf, usages, resolver, svelteMajor)
          : new Map(),
    };
    for (const key of usages.keys()) {
      const model = modelOf(key);
      for (const contextKey of model.providedContexts) {
        next.keys.add(contextKey);
      }
      next.unknown ||= model.providesUnknownContext;
    }
    if (
      next.keys.size === provided.keys.size &&
      next.unknown === provided.unknown &&
      sameValues(provided.values, next.values)
    ) {
      const classes = new Set<string>();
      const prefixes = new Set<string>();
      for (const result of live.values()) {
        for (const cls of result.classes) classes.add(cls);
        for (const prefix of result.prefixes) prefixes.add(prefix);
      }
      return { usages, resolver, classes, prefixes };
    }
    provided = next;
  }
}

function startsWithAny(cls: string, prefixes: Iterable<string>): boolean {
  for (const prefix of prefixes) if (cls.startsWith(prefix)) return true;
  return false;
}

/**
 * Which library classes the app can never render, given how it calls each
 * component: every class the components it renders can't apply under the
 * app's props, unless one of the library's `.js` modules names it. The walk
 * collects every class literal and template prefix in what renders, so a
 * class it doesn't see can't be applied: one only a dead branch applies,
 * or one of a component that never renders at all.
 *
 * Throws if a component can't be modeled; callers fall back to pruning
 * without props.
 */
export async function analyzeUsage(input: {
  library: Library;
  /** Library module keys in the bundle. */
  bundled: Iterable<string>;
  modules: Iterable<ModuleUsage>;
  options?: UsageOptions;
}): Promise<UsageAnalysis> {
  const { library } = input;
  recheckScriptModels();
  const sources = await readLibrarySources(library);
  const bundled = [...input.bundled];
  const options = input.options ?? {};
  // Each model once per analysis: `loadComponentModel` checks the file's
  // mtime, and the passes ask for the same models thousands of times.
  const models = new Map<string, ComponentModel>();
  const modelOf = (key: string): ComponentModel => {
    let model = models.get(key);
    if (!model) {
      model = loadComponentModel(library.src, key);
      models.set(key, model);
    }
    return model;
  };

  const excluded = new Set(
    (options.exclude ?? []).flatMap((name) => {
      const key = library.components.get(name);
      return key ? [key] : [];
    }),
  );
  const assumed = new Map<string, Map<string, Value>>();
  for (const [name, props] of Object.entries(options.assume ?? {})) {
    const key = library.components.get(name);
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
  let appReadsContext = false;
  let openAll = false;
  for (const module of input.modules) {
    openAll ||= module.openAll;
    for (const key of module.providedContexts) appContexts.add(key);
    appProvidesUnknown ||= module.providesUnknownContext === true;
    appReadsContext ||= module.readsLibraryContext === true;
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

  const unknownKeys = appProvidesUnknown || sources.unknownScriptContext;
  const precise = runPass(
    modelOf,
    roots,
    (provided) => (key) => {
      if (
        provided.unknown ||
        unknownKeys ||
        appContexts.has(key) ||
        sources.scriptContexts.has(key) ||
        // A key set some way this scan can't see (a constant, a helper).
        !sources.componentContexts.has(key)
      ) {
        return UNKNOWN;
      }
      if (!provided.keys.has(key)) return UNDEFINED;
      return provided.values.get(key) ?? UNKNOWN;
    },
    excluded,
    !sources.scriptReadsContext && !appReadsContext,
    library,
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
      // written against (`.x--date-picker` for every input DatePicker can
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
        ? createScope(modelOf(key), usage, precise.resolver, {
            svelteMajor: library.svelteMajor,
          })
        : undefined;
    },
  };
}
