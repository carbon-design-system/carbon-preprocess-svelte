import { parse, walk } from "svelte/compiler";

interface SelectorMarkup {
  type: "Element" | "Attribute" | "Class";
}

interface SelectorStyle {
  type: "PseudoClassSelector";
  name: "global" | string;
}

interface SelectorFromIdentifier {
  type: "FromIdentifier";
}

type Selector = SelectorMarkup | SelectorStyle | SelectorFromIdentifier;

export type ExtractedSelectors = [string, Selector][];

interface NodeClassAttributeMustacheTag {
  type: "MustacheTag";
  expression?: {
    type: "Identifier";
    name: string;
  };
}

interface NodeClassAttributeText {
  type: "Text";
  data: string;
}

type NodeClassAttribute =
  | NodeClassAttributeMustacheTag
  | NodeClassAttributeText;

interface NodeIdentifierLiteral {
  init?: {
    type: "Literal";
    value: string;
  };
}

interface NodeIdentifierCallExpression {
  init?: {
    type: "CallExpression";
    callee?: {
      object?: {
        elements?: Array<
          | { type: "Literal"; value: string }
          | { type: "LogicalExpression"; right?: { value: string } }
        >;
      };
    };
  };
}

type ParentNode = NodeIdentifierLiteral | NodeIdentifierCallExpression;

interface NodeIdentifier {
  type: "Identifier";
  name: string;
}

interface NodeElement {
  type: "Element";
  name: string;
}

interface NodeAttribute {
  type: "Attribute";
  name: string;
  value?: NodeClassAttribute[];
}

interface NodeClass {
  type: "Class";
  name: string;
}

interface NodePseudoClassSelector {
  type: "PseudoClassSelector";
  name: "global" | string;
  children: [child?: { value: string }];
}

interface NodeLiteral {
  type: "Literal";
  value: string;
}

interface NodeTemplateElement {
  type: "TemplateElement";
  value: { raw: string };
}

type Node =
  | NodeIdentifier
  | NodeElement
  | NodeAttribute
  | NodeClass
  | NodePseudoClassSelector
  | NodeLiteral
  | NodeTemplateElement;

function toArray(value: any) {
  if (typeof value === "string") {
    return value.split(/\s+/).map((value) => value.trim());
  }

  return [];
}

const MARKUP_SELECTOR = ["Element"];
const CLASS_SELECTOR = ["Attribute", "Class", "FromIdentifier"];
const STYLE_SELECTOR = ["PseudoClassSelector"];
const CARBON_PREFIX = /bx--/;

export function extractSelectors(
  template: string,
  filename?: string
): ExtractedSelectors {
  const ast = parse(template, { filename });
  const selectors: Map<string, Selector> = new Map();
  const identifiers: Set<string> = new Set();
  const ids: Map<string, { value: string[] }> = new Map();

  walk(ast, {
    enter(node: Node, parent: ParentNode) {
      if (node.type === "Identifier") {
        const id = node.name;

        if (parent.init?.type === "Literal") {
          ids.set(id, { value: toArray(parent.init.value) });
        }

        if (parent.init?.type === "CallExpression") {
          parent.init.callee?.object?.elements?.forEach((element) => {
            if (element.type === "Literal") {
              ids.set(id, { value: toArray(element.value) });
            }

            if (element.type === "LogicalExpression" && element.right?.value) {
              ids.set(id, { value: toArray(element.right?.value) });
            }
          });
        }
      }

      if (node.type === "Element") {
        // <div />
        selectors.set(node.name, { type: node.type });
      }

      if (node.type === "Attribute" && node.name === "class") {
        // class="c1"
        // class="c1 c2"
        // class="{c} c1 c2 c3"
        node.value?.map((value: NodeClassAttribute) => {
          if (value.type === "MustacheTag") {
            if (value.expression?.type === "Identifier") {
              identifiers.add(value.expression.name);
            }
          } else if (value.type === "Text") {
            value.data
              .split(/\s+/)
              .filter(Boolean)
              .forEach((selector) =>
                selectors.set(selector, { type: node.type })
              );
          }
        });
      }

      // class:directive
      if (node.type === "Class") {
        selectors.set(node.name, { type: node.type });
      }

      if (node.type === "PseudoClassSelector" && node.name === "global") {
        // global selector
        // :global(div) {}
        node.children[0]?.value.split(",").forEach((selector: string) => {
          selectors.set(selector.trim(), { type: node.type, name: node.name });
        });
      }

      if (node.type === "Literal" && CARBON_PREFIX.test(node.value)) {
        selectors.set(node.value, { type: "Class" });
      }

      if (
        node.type === "TemplateElement" &&
        CARBON_PREFIX.test(node.value.raw)
      ) {
        selectors.set(node.value.raw, { type: "Class" });
      }
    },
  });

  identifiers.forEach((id) => {
    if (ids.has(id)) {
      ids.get(id)!.value.forEach((value) => {
        selectors.set(value, { type: "FromIdentifier" });
      });
    }
  });

  // iterate through all class attribute identifiers
  return Array.from(selectors).map((selector) => {
    const [value, meta] = selector;

    if (CLASS_SELECTOR.includes(meta.type)) {
      return ["." + value, meta];
    }

    return selector;
  });
}
