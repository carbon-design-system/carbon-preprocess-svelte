import { walk } from "estree-walker";
import { parse } from "svelte/compiler";
import { CarbonSvelte } from "../constants";

const CARBON_PKG = CarbonSvelte.Components;
const RE_SVELTE = /\.svelte$/;

/**
 * A gate describing the single public prop that controls whether a Carbon
 * component emits a given CSS class. Only two shapes are supported:
 * - `eq`: emitted when `prop === <one of values>` (a disjunction over the
 *   *same* prop, e.g. `size === "small"` or `size === "sm"`).
 * - `truthy`: emitted when `prop` is truthy (e.g. `expressive && "..."`).
 *
 * Any class whose emission depends on anything more complex (interpolation,
 * derived variables, multiple props, negation) is recorded as `unconditional`
 * instead and is never pruned.
 */
export type PropGate =
  | { kind: "eq"; prop: string; values: string[] }
  | { kind: "truthy"; prop: string };

/** Per-component gate analysis extracted from a Carbon component's source. */
export type ComponentConditions = {
  /** Class selector (e.g. ".bx--btn--lg") -> the single-prop gate controlling it. */
  conditional: Record<string, PropGate>;
  /** Class selectors that are always emitted (the safe, always-keep bucket). */
  unconditional: string[];
  /** Literal default values from `export let prop = <literal>`. */
  propDefaults: Record<string, string | boolean>;
};

/** Observed prop usage for a single prop across all instances of a component. */
export type PropObservation = {
  /** Literal values passed (strings) or boolean `true` (shorthand). */
  values: Array<string | boolean>;
  /** `true` when any usage bound the prop dynamically (`{x}`, `bind:`). */
  poisoned: boolean;
  /** Number of instances that explicitly provided this prop. */
  providedCount: number;
};

/** Observed usage of a single Carbon component across the analyzed scope. */
export type ComponentObservation = {
  /** Total number of `<Component>` instances seen. */
  instances: number;
  /** `true` when any instance used a spread (`{...x}`), poisoning every prop. */
  spreadPoison: boolean;
  props: Record<string, PropObservation>;
};

/** Component name -> aggregated observation. */
export type Observed = Record<string, ComponentObservation>;

/** The generated conditions index shape (written to `component-conditions.ts`). */
export type ConditionsIndex = {
  /** Gate analysis keyed by component basename (exported + internal). */
  conditions: Record<string, ComponentConditions>;
  /**
   * Carbon-internal composition: for each Carbon component basename, the
   * usage of its Carbon children. Merged at build time for every in-graph
   * Carbon component so that classes a parent emits via a child (e.g. an
   * inline notification rendering `<Button size="small">`) are never pruned.
   */
  internalUsages: Record<string, Observed>;
};

function basename(filepath: string): string {
  const file = filepath.split("/").pop() ?? filepath;
  return file.replace(RE_SVELTE, "");
}

function emptyProp(): PropObservation {
  return { values: [], poisoned: false, providedCount: 0 };
}

function emptyComponent(): ComponentObservation {
  return { instances: 0, spreadPoison: false, props: {} };
}

function getComponent(observed: Observed, name: string): ComponentObservation {
  const existing = observed[name];
  if (existing) return existing;
  const created = emptyComponent();
  observed[name] = created;
  return created;
}

function getProp(record: ComponentObservation, name: string): PropObservation {
  const existing = record.props[name];
  if (existing) return existing;
  const created = emptyProp();
  record.props[name] = created;
  return created;
}

type ExtractUsagesOptions = {
  code: string;
  filename: string;
  /**
   * When `true`, default imports from relative `*.svelte` paths are treated as
   * Carbon component references (used when analyzing Carbon's own source, where
   * children are imported via relative paths). When `false` (the default, for
   * app source), only imports resolving to `carbon-components-svelte` count.
   */
  treatRelativeSvelteAsComponent?: boolean;
};

type ExtractUsagesResult = {
  /** `false` if the file could not be parsed. */
  ok: boolean;
  observed: Observed;
  /** `true` if a `<svelte:component>` with a dynamic `this` was seen. */
  dynamicComponent: boolean;
};

/**
 * Parses a Svelte file and records how each imported Carbon component is used:
 * which props are passed, their literal values, and whether any usage is
 * dynamic (poisoning the analysis). Shared by the build-time conditions
 * generator (over Carbon source) and the Vite plugin (over app source).
 */
export function extractUsages(
  options: ExtractUsagesOptions,
): ExtractUsagesResult {
  const { code, filename } = options;
  const treatRelative = options.treatRelativeSvelteAsComponent ?? false;

  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(code, { filename });
  } catch {
    return { ok: false, observed: {}, dynamicComponent: false };
  }

  // Map a component's local identifier to its Carbon component basename.
  const localToComponent = new Map<string, string>();

  // Pass 1: resolve Carbon component imports. Script declarations and markup
  // live in different AST branches and walk order is not guaranteed, so
  // imports are collected up front in their own pass.
  walk(ast, {
    enter(node) {
      if (node.type !== "ImportDeclaration") return;
      const source = node.source?.value;
      if (typeof source !== "string") return;

      if (source === CARBON_PKG) {
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier") {
            localToComponent.set(specifier.local.name, specifier.imported.name);
          }
        }
        return;
      }

      const isCarbonPath = source.includes(CARBON_PKG);
      const isRelative = source.startsWith(".");
      if (
        RE_SVELTE.test(source) &&
        (isCarbonPath || (treatRelative && isRelative))
      ) {
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportDefaultSpecifier") {
            localToComponent.set(specifier.local.name, basename(source));
            break;
          }
        }
      }
    },
  });

  const observed: Observed = {};
  let dynamicComponent = false;

  // Pass 2: record how each imported Carbon component is instantiated.
  walk(ast, {
    enter(node) {
      if (node.type !== "InlineComponent") return;

      if (node.name === "svelte:component") {
        // The rendered component is only known at runtime; can't analyze it.
        dynamicComponent = true;
        return;
      }

      const component = localToComponent.get(node.name);
      if (!component) return;

      const record = getComponent(observed, component);
      record.instances++;

      for (const attr of node.attributes ?? []) {
        if (attr.type === "Spread") {
          record.spreadPoison = true;
          continue;
        }

        if (attr.type === "Binding") {
          const prop = getProp(record, attr.name);
          prop.poisoned = true;
          prop.providedCount++;
          continue;
        }

        if (attr.type === "Attribute") {
          const prop = getProp(record, attr.name);
          prop.providedCount++;

          const value = attr.value;
          if (value === true) {
            // Boolean shorthand: <Button expressive />
            prop.values.push(true);
          } else if (
            Array.isArray(value) &&
            value.length === 1 &&
            value[0].type === "Text"
          ) {
            prop.values.push(value[0].data);
          } else {
            // MustacheTag / mixed text+expression -> dynamic, can't analyze.
            prop.poisoned = true;
          }
        }
        // EventHandler, Action, Let, Transition, etc. are irrelevant to props.
      }
    },
  });

  return { ok: true, observed, dynamicComponent };
}

/** Merges `source` observations into `target` in place. */
export function mergeObserved(target: Observed, source: Observed): void {
  for (const [component, src] of Object.entries(source)) {
    const dest = getComponent(target, component);
    dest.instances += src.instances;
    dest.spreadPoison ||= src.spreadPoison;

    for (const [name, srcProp] of Object.entries(src.props)) {
      const destProp = getProp(dest, name);
      destProp.poisoned ||= srcProp.poisoned;
      destProp.providedCount += srcProp.providedCount;
      for (const value of srcProp.values) destProp.values.push(value);
    }
  }
}

function isFalsy(value: string | boolean): boolean {
  return value === false || value === "";
}

/**
 * Determines whether a gated class is provably unreachable given the observed
 * usage of its component. Returns `false` (keep) whenever anything is uncertain.
 */
function isPrunable(
  gate: PropGate,
  defaults: Record<string, string | boolean>,
  obs: ComponentObservation,
): boolean {
  if (obs.spreadPoison) return false;

  const prop = obs.props[gate.prop];
  if (prop?.poisoned) return false;

  const values = new Set<string | boolean>(prop?.values ?? []);

  // If any instance omitted the prop, its default value is in play.
  const omits = obs.instances > (prop?.providedCount ?? 0);
  if (omits) {
    if (Object.hasOwn(defaults, gate.prop)) {
      values.add(defaults[gate.prop]);
    } else {
      // Unknown default -> can't prove unreachability.
      return false;
    }
  }

  if (gate.kind === "truthy") {
    for (const value of values) {
      if (!isFalsy(value)) return false;
    }
    return true;
  }

  // eq: prunable only if no observed value matches any gate value.
  for (const value of values) {
    if (typeof value === "string" && gate.values.includes(value)) return false;
  }
  return true;
}

/**
 * Computes the set of class selectors that are provably unreachable across the
 * whole app. A class is pruned only when its declaring component's gate proves
 * it dead AND no component ever emits it unconditionally.
 */
export function computePruneSet(
  conditions: Record<string, ComponentConditions>,
  observed: Observed,
): Set<string> {
  const everUnconditional = new Set<string>();
  for (const entry of Object.values(conditions)) {
    for (const cls of entry.unconditional) everUnconditional.add(cls);
  }

  const prune = new Set<string>();
  for (const [name, entry] of Object.entries(conditions)) {
    const obs = observed[name];
    if (!obs || obs.instances === 0) continue;

    for (const [cls, gate] of Object.entries(entry.conditional)) {
      if (everUnconditional.has(cls)) continue;
      if (isPrunable(gate, entry.propDefaults, obs)) prune.add(cls);
    }
  }

  return prune;
}
