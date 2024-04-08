import { parse, walk } from "svelte/compiler";
import { CARBON_PREFIX } from "../src/constants";

type ExtractSelectorsProps = {
  code: string;
  filename: string;
};

export function extractSelectors(props: ExtractSelectorsProps) {
  const { code, filename } = props;
  const ast = parse(code, { filename });
  const selectors: Map<string, any> = new Map();

  walk(ast, {
    enter(node) {
      if (node.type === "Attribute" && node.name === "class") {
        // class="c1"
        // class="c1 c2"
        // class="{c} c1 c2 c3"
        node.value?.map((value) => {
          if (value.type === "Text") {
            value.data
              .split(/\s+/)
              .filter(Boolean)
              .forEach((selector) =>
                selectors.set(selector, { type: node.type }),
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

  const classes: string[] = [];

  // Iterate through all class attribute identifiers
  Array.from(selectors).forEach((selector) => {
    const [v = ""] = selector;

    if (typeof v === "string") {
      const value = v.trim();

      if (value.startsWith("bx--") && !value.startsWith(".")) {
        classes.push("." + value);
      } else {
        if (value.startsWith(".")) {
          classes.push(value);
        } else {
          classes.push("." + value);
        }
      }
    }
  });

  return classes;
}
