import {
  join,
  OBJECT,
  possible,
  UNDEFINED,
  UNKNOWN,
  type Value,
} from "./values";

/** One place a library component is rendered. */
export type CallSite = {
  /** Library module key, relative to its `srcDir`: `Button/Button.svelte`. */
  component: string;
  /**
   * Every prop and slot is unknown: the site spreads props, or the
   * component is used as a value (`this={Button}`, passed as a prop).
   */
  open: boolean;
  /** Props this site passes. */
  props: Map<string, Value>;
  /** Slots this site fills (a snippet fills its name's); `null` when that can't be told. */
  slots: Set<string> | null;
  /**
   * The site passes content outside any snippet or `slot="…"` element:
   * Svelte 5 passes it as the `children` prop (see `addCallSite`).
   */
  children?: boolean;
  /**
   * With `bind:this`: the members the parent reads off the component's
   * instance, or `null` when it uses the instance any other way (see
   * `instanceMembers`).
   */
  instance?: ReadonlySet<string> | null;
  /** Where the site is. Only set for app files, for the report. */
  location?: { file: string; line: number };
  /** Why the site is `open`, for the report. */
  reason?: string;
  /**
   * Why each prop the site passes as unknown is unknown, for the report.
   * A function is only asked when no earlier site gave a reason.
   */
  why?: Map<string, string | (() => string | undefined)>;
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
 * `site`, open when what it renders can get props no call site shows: a
 * custom element, or one whose parent may set them through its instance
 * (`$set`, accessors, or by handing the instance on).
 */
export function checkTarget(
  site: CallSite,
  target: {
    propNames: ReadonlyMap<string, string>;
    customElement: boolean;
  },
): CallSite {
  if (site.open) return site;
  if (target.customElement) {
    return { ...site, open: true, reason: "is a custom element" };
  }
  const { instance } = site;
  if (instance === undefined) return site;
  const props = new Set(target.propNames.values());
  if (instance === null || [...instance].some((name) => props.has(name))) {
    return {
      ...site,
      open: true,
      reason: "is bound with `bind:this`, and its instance may set its props",
    };
  }
  return site;
}

/**
 * The props `site` passes, its content included: Svelte 5 passes it as
 * `children`, Svelte 3/4 as a slot only, and with no Svelte installed to
 * tell, it may be either.
 */
function propsOf(
  site: CallSite,
  svelteMajor: number | undefined,
): Map<string, Value> {
  if (!site.children || (svelteMajor !== undefined && svelteMajor < 5)) {
    return site.props;
  }
  const props = new Map(site.props);
  props.set(
    "children",
    svelteMajor === undefined
      ? join(site.props.get("children") ?? UNDEFINED, possible(OBJECT))
      : possible(OBJECT),
  );
  return props;
}

/**
 * Merges `site` into `usage`, for an app that compiles with Svelte
 * `svelteMajor`. Returns whether anything the analysis reads changed, so
 * the caller knows to walk the component again.
 */
export function addCallSite(
  usage: ComponentUsage,
  site: CallSite,
  propNames: Iterable<string>,
  svelteMajor: number | undefined,
): boolean {
  let changed = usage.siteCount === 0;
  const props = propsOf(site, svelteMajor);
  if (site.location) usage.appSites.push(site);

  if (site.open && !usage.open) {
    usage.open = true;
    usage.openReason = site.reason;
    changed = true;
  }
  for (const [name, why] of site.why ?? []) {
    if (usage.unknownBecause.has(name)) continue;
    const reason = typeof why === "string" ? why : why();
    if (reason) usage.unknownBecause.set(name, reason);
  }

  for (const [name, value] of props) {
    const before = usage.props.get(name);
    // A key earlier sites didn't pass was absent there.
    if (
      usage.siteCount > 0 &&
      before === undefined &&
      !usage.omitted.has(name)
    ) {
      usage.omitted.add(name);
      changed = true;
    }
    const after = before === undefined ? value : join(before, value);
    if (!sameValue(before, after)) {
      usage.props.set(name, after);
      changed = true;
    }
  }
  // Declared props and every key some site passes: absent here.
  const markAbsent = (name: string) => {
    if (!(props.has(name) || usage.omitted.has(name))) {
      usage.omitted.add(name);
      changed = true;
    }
  };
  for (const name of propNames) markAbsent(name);
  for (const name of usage.props.keys()) markAbsent(name);

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
