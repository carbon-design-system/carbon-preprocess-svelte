import { components as staticComponents } from "./component-index";
import type { ComponentIndex } from "./indexer/build-index";

let active: ComponentIndex = staticComponents;

/**
 * The component index consumers read from. Defaults to the frozen, checked-in
 * index; swapped once by `resolveLiveComponentIndex` when a plugin opts in
 * with `experimental.liveIndex: true`.
 *
 * Process-wide by design for this prototype: every `optimizeImports`/
 * `optimizeCss` instance in a build shares one active index, which is exactly
 * right for the common case (one Carbon version per build) but means mixing
 * an `experimental.liveIndex: true` instance with a default instance in the
 * same process affects both.
 */
export function getComponents(): ComponentIndex {
  return active;
}

export function setComponents(next: ComponentIndex): void {
  active = next;
}
