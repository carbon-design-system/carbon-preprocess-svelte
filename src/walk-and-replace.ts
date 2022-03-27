import { BreakpointName } from "@carbon/elements";
import { parse, walk } from "svelte/compiler";
import {
  Ast,
  TemplateNode,
  Style,
  Script,
} from "svelte/types/compiler/interfaces";

type ContentType = "script" | "style" | "markup";

interface WalkAndReplaceOptions {
  type: ContentType;
  content: string;
  filename: string;
}

const OFFSET = {
  script: "<script>",
  style: "<style>",
  markup: "",
};

const clampContent = (type: ContentType, content: string) => {
  switch (type) {
    case "script":
      return `<script>${content}</script>`;
    case "style":
      return `<style>${content}</style>`;
    default:
      return content;
  }
};

type GetAst = (type: ContentType, ast: Ast) => TemplateNode | Style | Script;

const getAst: GetAst = (type, ast) => {
  switch (type) {
    case "script":
      return ast.instance;
    case "style":
      return ast.css;
    case "markup":
      return ast.html;
  }
};

interface NodeMeta {
  start: number;
  end: number;
}

interface NodeElement extends NodeMeta {
  type: "Element";
  name: string;
  attributes: Array<
    NodeMeta & {
      type: "Attribute";
      name: string;
      value: true | [{ type?: "Text"; raw: string }];
    }
  >;
  children: Array<NodeText | NodeElement>;
}

export interface NodeText {
  type?: "Text";
  raw: string;
}

interface NodeImportDeclaration extends NodeMeta {
  type: "ImportDeclaration";
  source: { value: string };
  specifiers: Array<{
    local: { name: string };
    imported: { name: string };
  }>;
}

interface NodeExportSpecifier extends NodeMeta {
  type: "ExportSpecifier";
  local: { name: string };
}

interface NodeDeclaration extends NodeMeta {
  type: "Declaration";
  property: string;
  value: NodeMeta & {
    children: NodeChildString[];
  };
}

interface NodeRule extends NodeMeta {
  type: "Rule";
  prelude: NodeMeta & {
    type: "SelectorList";
    children: Array<
      NodeMeta & {
        type: "Selector";
        name: "div";
      }
    >;
  };
  block: NodeMeta & {
    children: NodeDeclaration[];
  };
}

export interface MediaFeature {
  type: "MediaFeature";
  name: "down" | "up" | "bp" | "between" | BreakpointName;
  value:
    | null
    | { name: BreakpointName }
    | { type: "Dimension"; value: string; unit: string };
}

interface NodeAtRule extends NodeMeta {
  type: "Atrule";
  name: string;
  prelude: NodeMeta & {
    type: string;
    children: Array<{
      type: "MediaQueryList";
      children: Array<{
        type: "MediaQuery";
        children: Array<
          | MediaFeature
          | {
              type: "WhiteSpace";
            }
          | {
              type: "Identifier";
              name: string; // "and" | "lg" | "321px"
            }
        >;
      }>;
    }>;
  };
  block: NodeMeta & {
    type: "Block";
  };
}

interface NodeFunction extends NodeMeta {
  type: "Function";
  name: string; // "rgba" | "rem" | "em" | "px";
  children: Array<{
    type: "HexColor" | "Operator" | "Number" | "Dimension";
    value: string;
  }>;
}

export interface NodeChildString extends NodeMeta {
  type?: string;
  value: string;
}

export type Node =
  | NodeElement
  | NodeImportDeclaration
  | NodeExportSpecifier
  | NodeDeclaration
  | NodeRule
  | NodeAtRule
  | NodeFunction;
export function walkAndReplace(
  options: WalkAndReplaceOptions,
  replaceWith: (
    enter: { node: Node; parentNode: Node },
    replaceContent: (
      node: Node,
      replaceWith: string,
      replacee?: string
    ) => void,
    getContent: (node: NodeMeta) => string
  ) => void
) {
  let content = options.content;

  const ast = parse(clampContent(options.type, content), {
    filename: options.filename,
  });

  let cursor = -1 * OFFSET[options.type].length;

  function replaceContent(node: Node, replaceWith: string, replacee?: string) {
    let replaced =
      replacee ?? content.slice(node.start + cursor, node.end + cursor);
    content = content.replace(replaced, replaceWith);
    cursor += replaceWith.length - replaced.length;
  }

  function getContent(node: NodeMeta) {
    return content.slice(node.start + cursor, node.end + cursor);
  }

  walk(getAst(options.type, ast), {
    enter(node: Node, parentNode: Node) {
      replaceWith.apply(this, [
        { node, parentNode },
        replaceContent,
        getContent,
      ]);
    },
  });

  return content;
}
