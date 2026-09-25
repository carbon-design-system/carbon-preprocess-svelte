import {
  extractCarbonClassTokens,
  extractRuntimeClassesFromSource,
  resolveRelativeImport,
} from "./extract-runtime-classes";
import type { SvelteParser } from "./svelte-parser";
import { walk } from "./walk";

const WHITESPACE_REGEX = /\s+/;
const GLOBAL_SELECTOR_REGEX = /^:global\((.*)\)$/;

type ExtractSelectorsProps = {
  code: string;
  filename: string;
  parse: SvelteParser;
};

export type ExtractFromSvelteResult = {
  classes: string[];
  components: string[];
  slotWrappers: string[];
  imports: string[];
  runtimeClasses: string[];
};

function nodeContainsDefaultSlot(node: {
  type?: string;
  name?: string;
  fragment?: { nodes?: unknown[] };
  children?: unknown[];
}): boolean {
  if (
    node.type === "Slot" ||
    node.type === "SlotElement" ||
    (node.type === "Element" && node.name === "slot")
  ) {
    return true;
  }

  const children = node.fragment?.nodes ?? node.children ?? [];

  for (const child of children) {
    if (
      child &&
      typeof child === "object" &&
      nodeContainsDefaultSlot(child as typeof node)
    ) {
      return true;
    }
  }

  return false;
}

export function extractFromSvelte(
  props: ExtractSelectorsProps,
): ExtractFromSvelteResult {
  const { code, filename, parse } = props;
  const moduleKey = filename.replace(/\\/g, "/");
  const ast = parse(code, { filename });
  const selectors = new Set<string>();
  const components = new Set<string>();
  const slotWrappers: string[] = [];
  const imports: string[] = [];

  walk(ast, {
    enter(node) {
      if (node.type === "ImportDeclaration" && node.source?.value) {
        const resolved = resolveRelativeImport(
          moduleKey,
          String(node.source.value),
        );
        if (resolved) {
          imports.push(resolved);
        }
      }

      if (node.type === "InlineComponent") {
        if (node.name === "svelte:component") {
          components.add(node.expression.name);
        } else {
          components.add(node.name);
        }
      }

      if (node.type === "Attribute" && node.name === "class" && node.value) {
        for (const value of node.value) {
          if (value.type !== "Text") continue;
          for (const selector of value.data
            .split(WHITESPACE_REGEX)
            .filter(Boolean)) {
            selectors.add(selector);
          }
        }
      }

      if (node.type === "Class") {
        selectors.add(node.name);
      }

      if (node.type === "PseudoClassSelector" && node.name === "global") {
        const selector = code.slice(node.start, node.end);
        const cleanSelector = selector.replace(GLOBAL_SELECTOR_REGEX, "$1");
        selectors.add(cleanSelector);
      }

      // A string may hold several classes (`"bx--a bx--b"`), a selector
      // (`".bx--a .bx--b"`), or markup, so add each class it names.
      if (node.type === "Literal" && typeof node.value === "string") {
        for (const cls of extractCarbonClassTokens(node.value)) {
          selectors.add(cls);
        }
      }

      if (node.type === "TemplateElement") {
        for (const cls of extractCarbonClassTokens(node.value.raw)) {
          selectors.add(cls);
        }
      }

      if (node.type === "Element") {
        const wrapperClasses: string[] = [];

        for (const attribute of node.attributes ?? []) {
          if (attribute.type === "Class" && attribute.name.startsWith("bx--")) {
            wrapperClasses.push(`.${attribute.name}`);
          }
        }

        if (wrapperClasses.length > 0 && nodeContainsDefaultSlot(node)) {
          slotWrappers.push(...wrapperClasses);
        }
      }
    },
  });

  const classes: string[] = [];

  for (const raw of selectors) {
    const value = raw.trim();
    classes.push(value.startsWith(".") ? value : `.${value}`);
  }

  return {
    classes: [...new Set(classes)],
    components: [...new Set(components)],
    slotWrappers: [...new Set(slotWrappers)],
    imports: [...new Set(imports)],
    runtimeClasses: extractRuntimeClassesFromSource(code),
  };
}
