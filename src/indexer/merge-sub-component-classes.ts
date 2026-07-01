const MAX_PASSES = 10;

/**
 * Propagates each sub-component's classes up into every ancestor that
 * renders it, in place, regardless of `subComponents` insertion order.
 *
 * `componentClasses` maps a component name (exported or internal) to the
 * entry mutated with its merged classes; a parent absent from this map is
 * skipped as a merge target (but can still be read as a child's source).
 * Runs to a fixed point since a parent may need classes from a child that
 * hasn't itself absorbed its own children yet; a hard pass cap guards
 * against a malformed, non-DAG `subComponents` graph.
 */
export function mergeSubComponentClasses(
  subComponents: Map<string, string[]>,
  componentClasses: Map<string, { classes: string[] }>,
): void {
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;

    for (const [parent, children] of subComponents.entries()) {
      const parent_entry = componentClasses.get(parent);
      if (!parent_entry) continue;

      const sub_classes = children.flatMap(
        (component) => componentClasses.get(component)?.classes ?? [],
      );

      if (sub_classes.length === 0) continue;

      const merged = new Set([...parent_entry.classes, ...sub_classes]);
      if (merged.size > parent_entry.classes.length) {
        parent_entry.classes = [...merged];
        changed = true;
      }
    }

    if (!changed) return;
  }

  console.warn(
    `[index] mergeSubComponentClasses: hit ${MAX_PASSES}-pass cap without converging; ` +
      "subComponents graph may contain a cycle.",
  );
}
