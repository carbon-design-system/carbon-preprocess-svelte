import { type AST, forEachChild } from "sveast/walk";

export type Node = AST.SvelteNode;

/** Calls `visit` on `node` and every descendant, depth-first. */
export function forEachNode(
  node: Node | null | undefined,
  visit: (node: Node) => void,
): void {
  if (!node) return;
  const visitNode = (child: Node) => {
    visit(child);
    forEachChild(child, visitNode);
  };
  visitNode(node);
}
