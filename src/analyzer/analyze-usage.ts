import { readFileSync } from "node:fs";
import path from "node:path";
import { listJsAndSvelteFiles } from "../indexer/list-files";
import { collectCarbonTokens } from "../plugins/scan-content";
import type { CarbonComponents, ModuleUsage } from "./call-sites";
import { loadComponentModel } from "./component-model";
import { type ContextResolver, createScope } from "./evaluate";
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
   * Whether no rendered component can apply `cls` (`.bx--btn--danger`),
   * though a bundled one could under some props.
   */
  isPruned(cls: string): boolean;
};

const SRC_SEGMENT = /(?:^|[\\/])carbon-components-svelte[\\/]src[\\/](.+)$/;

/** `…/carbon-components-svelte/src/Button/Button.svelte` -> `Button/Button.svelte`. */
export function carbonModuleKey(id: string): string | undefined {
  return SRC_SEGMENT.exec(id)?.[1].replace(/\\/g, "/");
}

type CarbonSources = {
  /** Classes and prefixes Carbon's `.js` modules name; never pruned. */
  scriptTokens: Set<string>;
  /** `setContext` keys `.svelte` components pass as literals. */
  componentContexts: Set<string>;
  /** `setContext` keys `.js` modules pass as literals. */
  scriptContexts: Set<string>;
};

const SET_CONTEXT = /setContext\(\s*["']([^"']+)["']/g;
const carbonSourcesCache = new Map<string, CarbonSources>();

async function readCarbonSources(carbonSrc: string): Promise<CarbonSources> {
  const cached = carbonSourcesCache.get(carbonSrc);
  if (cached) return cached;
  const sources: CarbonSources = {
    scriptTokens: new Set(),
    componentContexts: new Set(),
    scriptContexts: new Set(),
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
  }
  carbonSourcesCache.set(carbonSrc, sources);
  return sources;
}

type Pass = {
  usages: Map<string, ComponentUsage>;
  classes: Set<string>;
  prefixes: Set<string>;
};

/**
 * Walks every component reachable from `roots` until no usage grows: a
 * component's child call sites feed the child's usage, which may make more
 * of the child live, and so on.
 */
function runPass(
  carbonSrc: string,
  roots: CallSite[],
  /** `null`: every prop and context unknown. */
  context: ((provided: Set<string>) => ContextResolver) | null,
): Pass {
  const forceOpen = context === null;
  let provided = new Set<string>();
  for (;;) {
    const usages = new Map<string, ComponentUsage>();
    const live = new Map<string, ReturnType<typeof walkLive>>();
    const queue: string[] = [];
    const resolver: ContextResolver = context
      ? context(provided)
      : () => UNKNOWN;

    const enqueue = (site: CallSite) => {
      const model = loadComponentModel(carbonSrc, site.component);
      let usage = usages.get(site.component);
      if (!usage) {
        usage = newComponentUsage();
        usages.set(site.component, usage);
      }
      const merged = forceOpen ? { ...site, open: true } : site;
      if (addCallSite(usage, merged, model.props.keys())) {
        queue.push(site.component);
      }
    };

    for (const site of roots) enqueue(site);
    for (let key = queue.shift(); key; key = queue.shift()) {
      const model = loadComponentModel(carbonSrc, key);
      const usage = usages.get(key);
      if (!usage) continue;
      const result = walkLive(createScope(model, usage, resolver));
      live.set(key, result);
      for (const site of result.childSites) enqueue(site);
    }

    // `getContext` reads `undefined` unless a rendered component provides
    // it. Rendering more can provide more, so repeat until that settles.
    const next = new Set(provided);
    for (const key of usages.keys()) {
      for (const contextKey of loadComponentModel(carbonSrc, key)
        .providedContexts) {
        next.add(contextKey);
      }
    }
    if (forceOpen || next.size === provided.size) {
      const classes = new Set<string>();
      const prefixes = new Set<string>();
      for (const result of live.values()) {
        for (const cls of result.classes) classes.add(cls);
        for (const prefix of result.prefixes) prefixes.add(prefix);
      }
      return { usages, classes, prefixes };
    }
    provided = next;
  }
}

function startsWithAny(cls: string, prefixes: Iterable<string>): boolean {
  for (const prefix of prefixes) if (cls.startsWith(prefix)) return true;
  return false;
}

function assumedValue(values: Array<string | number | boolean | null>): Value {
  return possible(...values);
}

/**
 * Which Carbon classes the app can never render, given how it calls each
 * component. Compares two walks of the bundled components: one with every
 * prop unknown (what the bundle could render), one with the app's props
 * (what it does render). A class only the first produces is pruned, unless
 * one of Carbon's `.js` modules names it.
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
  const sources = await readCarbonSources(carbonSrc);
  const bundled = [...input.bundled];
  const options = input.options ?? {};

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
          assumedValue(values),
        ]),
      ),
    );
  }

  const roots: CallSite[] = [];
  const appContexts = new Set<string>();
  let openAll = false;
  for (const module of input.modules) {
    openAll ||= module.openAll;
    for (const key of module.providedContexts) appContexts.add(key);
    for (const site of module.sites) {
      const assumptions = assumed.get(site.component);
      if (excluded.has(site.component)) {
        roots.push({ ...site, open: true, reason: "excluded" });
      } else if (assumptions && !site.open) {
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
    carbonSrc,
    roots,
    (provided) => (key) =>
      provided.has(key) ||
      appContexts.has(key) ||
      sources.scriptContexts.has(key) ||
      // A key set some way this scan can't see (a constant, a helper).
      !sources.componentContexts.has(key)
        ? UNKNOWN
        : UNDEFINED,
  );

  const everything = runPass(
    carbonSrc,
    [...bundled, ...precise.usages.keys()].map((component) => ({
      component,
      open: true,
      props: new Map(),
      slots: null,
    })),
    null,
  );

  const scriptPrefixes = [...sources.scriptTokens].filter((token) =>
    token.endsWith("-"),
  );
  const verdicts = new Map<string, boolean>();
  const isPruned = (cls: string): boolean => {
    let verdict = verdicts.get(cls);
    if (verdict === undefined) {
      verdict =
        (everything.classes.has(cls) ||
          startsWithAny(cls, everything.prefixes)) &&
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
  };
}
