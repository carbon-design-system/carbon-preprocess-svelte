import path from "node:path";
import { walk } from "estree-walker";
import { parse } from "svelte/compiler";
import { CARBON_PREFIX } from "../src/constants";
import { extractRuntimeClassesFromSource } from "./extract-runtime-classes";

const WHITESPACE_REGEX = /\s+/;
const GLOBAL_SELECTOR_REGEX = /^:global\((.*)\)$/;

type ExtractSelectorsProps = {
  code: string;
  filename: string;
};

export type ExtractFromSvelteResult = {
  classes: string[];
  components: string[];
  slotWrappers: string[];
  imports: string[];
  runtimeClasses: string[];
};

function resolveRelativeImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) {
    return null;
  }

  const base = path.posix.dirname(from);
  const joined = path.posix.normalize(path.posix.join(base, spec));

  if (joined.endsWith(".js") || joined.endsWith(".svelte")) {
    return joined;
  }

  return `${joined}.js`;
}

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

/**
 * Single-pass Svelte extraction: classes, sub-components, slot wrappers, imports.
 */
export function extractFromSvelte(
  props: ExtractSelectorsProps,
): ExtractFromSvelteResult {
  const { code, filename } = props;
  const moduleKey = filename.replace(/\\/g, "/");
  const ast = parse(code, { filename });
  const selectors: Map<string, { type: string; name?: string }> = new Map();
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

      if (node.type === "Attribute" && node.name === "class") {
        if (node.value) {
          for (const value of node.value) {
            if (value.type === "Text") {
              for (const selector of value.data
                .split(WHITESPACE_REGEX)
                .filter(Boolean)) {
                selectors.set(selector, { type: node.type });
              }
            }
          }
        }
      }

      if (node.type === "Class") {
        selectors.set(node.name, { type: node.type });
      }

      if (node.type === "PseudoClassSelector" && node.name === "global") {
        const selector = code.slice(node.start, node.end);
        const cleanSelector = selector.replace(GLOBAL_SELECTOR_REGEX, "$1");
        selectors.set(cleanSelector, { type: node.type, name: node.name });
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

  for (const [v = ""] of selectors) {
    if (typeof v === "string") {
      const value = v.trim();

      if (value.startsWith("bx--") && !value.startsWith(".")) {
        classes.push(`.${value}`);
      } else if (value.startsWith(".")) {
        classes.push(value);
      } else {
        classes.push(`.${value}`);
      }
    }
  }

  return {
    classes: [...new Set(classes)],
    components: [...new Set(components)],
    slotWrappers: [...new Set(slotWrappers)],
    imports: [...new Set(imports)],
    runtimeClasses: extractRuntimeClassesFromSource(code),
  };
}

export function extractSelectors(props: ExtractSelectorsProps) {
  const { classes, components } = extractFromSvelte(props);
  return { classes, components };
}

/** @deprecated Use `extractFromSvelte`. */
export function extractSlotWrappers(props: ExtractSelectorsProps): string[] {
  return extractFromSvelte(props).slotWrappers;
}
