// Runtime highlighting with the CSS Custom Highlight API: tokenize each
// code block's text and register a Range per token. Nothing in the DOM
// changes, so it works on CodeSnippet and on any `<pre><code>` (Chrome 105,
// Safari 17.2, Firefox 140). The tokenizer is the same one the build uses.
import { tokenize, tokenName } from "carbon-preprocess-svelte/code";
import { clearRanges, setRanges, supported } from "./intel/registry.js";

const OWNER = "page";

const LANGUAGE = /language-([\w-]+)/;

/** The text node and offset at a character offset inside `root`. */
function locate(nodes, offset) {
  for (const { node, start } of nodes) {
    if (offset <= start + node.length) return [node, offset - start];
  }
  const last = nodes.at(-1);
  return [last.node, last.node.length];
}

export function highlightAll(root = document) {
  if (!supported) return 0;
  const groups = new Map();
  let blocks = 0;
  // Code views highlight themselves.
  for (const code of root.querySelectorAll("pre:not([data-codeview]) code")) {
    const lang =
      LANGUAGE.exec(code.className)?.[1] ??
      LANGUAGE.exec(code.parentElement?.className ?? "")?.[1];
    const tokens = lang ? tokenize(code.textContent ?? "", lang) : undefined;
    if (!tokens) continue;
    blocks++;
    const nodes = [];
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    for (
      let start = 0, node = walker.nextNode();
      node;
      node = walker.nextNode()
    ) {
      nodes.push({ node, start });
      start += node.length;
    }
    if (nodes.length === 0) continue;
    let offset = 0;
    for (const { type, text } of tokens) {
      if (type) {
        const range = document.createRange();
        range.setStart(...locate(nodes, offset));
        range.setEnd(...locate(nodes, offset + text.length));
        const name = `syntax-${tokenName(type)}`;
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(range);
      }
      offset += text.length;
    }
  }
  setRanges(OWNER, groups);
  return blocks;
}

export function clearHighlights() {
  clearRanges(OWNER);
}
