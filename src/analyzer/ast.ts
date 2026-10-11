import { type AST, children } from "sveast/walk";

export type Node = AST.SvelteNode;

/** Calls `visit` on `node` and every descendant, depth-first. */
export function forEachNode(
  node: Node | null | undefined,
  visit: (node: Node) => void,
): void {
  if (!node) return;
  visit(node);
  for (const child of children(node)) forEachNode(child, visit);
}
