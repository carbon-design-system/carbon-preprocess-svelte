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

/** The identifier at the root of `a`, `a.b`, `a[b].c`; `""` for anything else. */
export function rootName(node: Node | null | undefined): string {
  let current = node;
  while (current?.type === "MemberExpression") current = current.object;
  return current?.type === "Identifier" ? current.name : "";
}
