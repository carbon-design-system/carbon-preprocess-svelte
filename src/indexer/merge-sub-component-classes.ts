import { LOG_PREFIX } from "../constants";

const MAX_PASSES = 10;

/**
 * Propagates each sub-component's classes up into every ancestor that
 * renders it, in place.
 *
 * `componentClasses` maps a component name (exported or internal) to the
 * entry mutated with its merged classes; a parent absent from it is skipped
 * as a merge target but can still be a child's source. Runs to a fixed point
 * (a parent may need a child's classes before the child has absorbed its
 * own), capped to guard against a cyclic `subComponents` graph.
 */
export function mergeSubComponentClasses(
  subComponents: Map<string, string[]>,
  componentClasses: Map<string, { classes: string[] }>,
): void {
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;

    for (const [parent, children] of subComponents) {
      const parentEntry = componentClasses.get(parent);
      if (!parentEntry) continue;

      const subClasses = children.flatMap(
        (child) => componentClasses.get(child)?.classes ?? [],
      );
      const merged = new Set([...parentEntry.classes, ...subClasses]);

      if (merged.size > parentEntry.classes.length) {
        parentEntry.classes = [...merged];
        changed = true;
      }
    }

    if (!changed) return;
  }

  console.warn(
    `${LOG_PREFIX} mergeSubComponentClasses hit the ${MAX_PASSES}-pass cap without converging; the sub-component graph may contain a cycle.`,
  );
}
