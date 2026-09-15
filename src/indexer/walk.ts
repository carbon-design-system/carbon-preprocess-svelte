/**
 * Svelte's own AST node types aren't exported from an installable path in
 * this version (`svelte/types/compiler/interfaces` re-exports nothing), so
 * call sites narrow by `node.type` and reach into shape-specific fields
 * (`node.source.value`, `node.expression.name`, `node.fragment.nodes`, …)
 * without a shared interface to check against.
 */
// biome-ignore lint/suspicious/noExplicitAny: no real AST type to narrow into, see above
export type ANode = any;

/**
 * Minimal stand-in for `estree-walker`'s `enter`-only walk: recurses into
 * every own property that is an array of typed nodes or a typed node
 * itself. Root gets visited unconditionally, same as upstream.
 */
export function walk(ast: ANode, options: { enter: (node: ANode) => void }) {
  visit(ast, options.enter);
}

function visit(node: ANode, enter: (node: ANode) => void) {
  enter(node);

  for (const key in node) {
    const value = node[key];

    if (typeof value !== "object" || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (
          item !== null &&
          typeof item === "object" &&
          typeof item.type === "string"
        ) {
          visit(item, enter);
        }
      }
    } else if (typeof value.type === "string") {
      visit(value, enter);
    }
  }
}
