import { type AST, visitorKeys } from "sveast/walk";

export type Node = AST.SvelteNode;

const keysByType = visitorKeys as unknown as Record<
  string,
  readonly string[] | undefined
>;

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/** A node's child nodes with the field holding each, in source order. */
export function childEntries(node: Node): Array<[field: string, child: Node]> {
  const children: Array<[string, Node]> = [];
  const fields = node as unknown as Record<string, unknown>;
  for (const key of keysByType[node.type] ?? []) {
    const value = fields[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) children.push([key, item]);
    } else if (isNode(value)) {
      children.push([key, value]);
    }
  }
  return children;
}

/**
 * Child nodes by node: the analysis walks each component's (unchanging)
 * tree again on every pass.
 */
const childrenOf = new WeakMap<Node, readonly Node[]>();

/** A node's child nodes, in source order. */
export function childNodes(node: Node): readonly Node[] {
  let children = childrenOf.get(node);
  if (!children) {
    const list: Node[] = [];
    const fields = node as unknown as Record<string, unknown>;
    for (const key of keysByType[node.type] ?? []) {
      const value = fields[key];
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) list.push(item);
      } else if (isNode(value)) {
        list.push(value);
      }
    }
    children = list;
    childrenOf.set(node, children);
  }
  return children;
}

/** Calls `visit` on `node` and every descendant, depth-first. */
export function forEachNode(
  node: Node | null | undefined,
  visit: (node: Node) => void,
): void {
  if (!node) return;
  visit(node);
  for (const child of childNodes(node)) forEachNode(child, visit);
}

/** The identifier at the root of `a`, `a.b`, `a[b].c`; `""` for anything else. */
export function rootName(node: Node | null | undefined): string {
  let current = node;
  while (current?.type === "MemberExpression") current = current.object;
  return current?.type === "Identifier" ? current.name : "";
}

/** Every name a binding pattern (or assignment target) writes to. */
export function patternNames(
  node: Node | null | undefined,
  into: Set<string>,
): void {
  if (!node) return;
  switch (node.type) {
    case "Identifier":
      into.add(node.name);
      break;
    case "MemberExpression":
      into.add(rootName(node));
      break;
    case "ObjectPattern":
      for (const property of node.properties) {
        patternNames(
          property.type === "RestElement" ? property.argument : property.value,
          into,
        );
      }
      break;
    case "ArrayPattern":
      for (const element of node.elements) patternNames(element, into);
      break;
    case "AssignmentPattern":
      patternNames(node.left, into);
      break;
    case "RestElement":
      patternNames(node.argument, into);
      break;
  }
}

const MAX_LINE_INDEXES = 256;
/** Offsets of each line break, by source: the analysis asks per call site. */
const lineBreaks = new Map<string, number[]>();

/** 1-based line of `offset` in `code`. */
export function lineAt(code: string, offset: number): number {
  let breaks = lineBreaks.get(code);
  if (!breaks) {
    breaks = [];
    for (let i = code.indexOf("\n"); i !== -1; i = code.indexOf("\n", i + 1)) {
      breaks.push(i);
    }
    if (lineBreaks.size >= MAX_LINE_INDEXES) lineBreaks.clear();
    lineBreaks.set(code, breaks);
  }
  // The number of breaks before `offset`.
  let low = 0;
  let high = breaks.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (breaks[middle] < offset) low = middle + 1;
    else high = middle;
  }
  return low + 1;
}
