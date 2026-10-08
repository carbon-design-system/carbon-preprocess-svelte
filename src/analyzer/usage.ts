import { join, possible, UNKNOWN, type Value } from "./values";

/** One place a Carbon component is rendered. */
export type CallSite = {
  /** Carbon module key, relative to its `src`: `Button/Button.svelte`. */
  component: string;
  /**
   * Every prop and slot is unknown: the site spreads props, or the
   * component is used as a value (`this={Button}`, passed as a prop).
   */
  open: boolean;
  /** Props this site passes. */
  props: Map<string, Value>;
  /** Slots this site fills; `null` when that can't be told (snippets). */
  slots: Set<string> | null;
  /** Where the site is. Only set for app files, for the report. */
  location?: { file: string; line: number };
  /** Why the site is `open`, for the report. */
  reason?: string;
  /** Why each prop the site passes as unknown is unknown, for the report. */
  why?: Map<string, string>;
};

/** Every call site of one component, merged. */
export type ComponentUsage = {
  open: boolean;
  /** Values seen per prop, across the sites that pass it. */
  props: Map<string, Value>;
  /**
   * Props some site leaves out: a declared prop's default applies there,
   * and an undeclared key (`$$restProps`) is absent.
   */
  omitted: Set<string>;
  /**
   * Per slot name, `$$slots[name]` across sites: `true` where it's filled,
   * `undefined` where it isn't (Svelte only sets filled slots' keys).
   */
  slots: Map<string, Value>;
  slotsUnknown: boolean;
  siteCount: number;
  /** App call sites, for the report. */
  appSites: CallSite[];
  /** Why the usage is open: the first open site's reason. */
  openReason?: string;
  /** Why each unknown prop is unknown: the first site that made it so. */
  unknownBecause: Map<string, string>;
};

export function newComponentUsage(): ComponentUsage {
  return {
    open: false,
    props: new Map(),
    omitted: new Set(),
    slots: new Map(),
    slotsUnknown: false,
    siteCount: 0,
    appSites: [],
    unknownBecause: new Map(),
  };
}

function sameValue(a: Value | undefined, b: Value | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === UNKNOWN || b === UNKNOWN) {
    return false;
  }
  if (a.size !== b.size) return false;
  for (const p of a) if (!b.has(p)) return false;
  return true;
}

/**
 * Merges `site` into `usage`. Returns whether anything the analysis reads
 * changed, so the caller knows to walk the component again.
 */
export function addCallSite(
  usage: ComponentUsage,
  site: CallSite,
  propNames: Iterable<string>,
): boolean {
  let changed = usage.siteCount === 0;
  if (site.location) usage.appSites.push(site);

  if (site.open && !usage.open) {
    usage.open = true;
    usage.openReason = site.reason;
    changed = true;
  }
  for (const [name, why] of site.why ?? []) {
    if (!usage.unknownBecause.has(name)) usage.unknownBecause.set(name, why);
  }

  /** Keys earlier sites passed: a key first seen here was absent there. */
  const seen = new Set(usage.props.keys());
  for (const [name, value] of site.props) {
    if (usage.siteCount > 0 && !seen.has(name) && !usage.omitted.has(name)) {
      usage.omitted.add(name);
      changed = true;
    }
    const before = usage.props.get(name);
    const after = before === undefined ? value : join(before, value);
    if (!sameValue(before, after)) {
      usage.props.set(name, after);
      changed = true;
    }
  }
  // Declared props and every key some site passes: absent here.
  for (const name of [...propNames, ...seen]) {
    if (!(site.props.has(name) || usage.omitted.has(name))) {
      usage.omitted.add(name);
      changed = true;
    }
  }

  if (site.slots === null) {
    if (!usage.slotsUnknown) changed = true;
    usage.slotsUnknown = true;
  } else {
    const names = new Set([...usage.slots.keys(), ...site.slots]);
    for (const name of names) {
      const before = usage.slots.get(name);
      // A slot first filled here was empty at every earlier site.
      const base =
        before ?? (usage.siteCount > 0 ? possible(undefined) : possible());
      const after = join(
        base,
        possible(site.slots.has(name) ? true : undefined),
      );
      if (!sameValue(before, after)) {
        usage.slots.set(name, after);
        changed = true;
      }
    }
  }

  usage.siteCount++;
  return changed;
}
