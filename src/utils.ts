import MagicString from "magic-string";
import { type ImportDeclaration } from "svelte/compiler";

export function rewriteImport(
  s: MagicString,
  node: ImportDeclaration,
  map: (specifier: ImportDeclaration["specifiers"][0]) => string
) {
  let content = "";

  for (const specifier of node.specifiers) {
    const fragment = map(specifier);
    if (fragment) content += fragment;
  }

  if (content) s.overwrite(node.start, node.end, content);
}
