import { type AST, walk } from "sveast";
import {
  extractCarbonClassTokens,
  extractRuntimeClassesFromSource,
  relativeImports,
} from "./extract-runtime-classes";
import { parse } from "./parser";

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
  /**
   * Classes named by literals in the module script (`context="module"` or
   * Svelte 5's `module`), minus lookup selectors: what another module can
   * import from this one.
   */
  moduleClasses: string[];
};

/** Classes a string or template literal node names; `[]` for any other node. */
function literalClasses(
  node: AST.SvelteNode,
  options?: { skipLookups?: boolean },
): string[] {
  if (node.type === "Literal" && typeof node.value === "string") {
    return extractCarbonClassTokens(node.value, options);
  }
  if (node.type === "TemplateElement") {
    return extractCarbonClassTokens(node.value.raw, options);
  }
  return [];
}

export function extractFromSvelte(
  props: ExtractSelectorsProps,
): ExtractFromSvelteResult {
  const { code, filename } = props;
  const moduleKey = filename.replace(/\\/g, "/");
  const ast = parse(code, { comments: false });
  const selectors = new Set<string>();
  const components = new Set<string>();
  const slotWrappers = new Set<string>();
  const moduleClasses = new Set<string>();
  // Elements with `bx--` class directives the walk is inside of. A `<slot>`
  // anywhere under one, in any branch, makes its classes wrap slotted content.
  const openWrappers: { node: AST.SvelteNode; classes: string[] }[] = [];

  walk(ast, {
    enter(node) {
      if (node.type === "Component") {
        components.add(node.name);
      }

      if (
        node.type === "SvelteComponent" &&
        node.expression.type === "Identifier"
      ) {
        components.add(node.expression.name);
      }

      if (
        node.type === "Attribute" &&
        node.name === "class" &&
        Array.isArray(node.value)
      ) {
        for (const value of node.value) {
          if (value.type !== "Text") continue;
          for (const selector of value.data
            .split(WHITESPACE_REGEX)
            .filter(Boolean)) {
            selectors.add(selector);
          }
        }
      }

      if (node.type === "ClassDirective") {
        selectors.add(node.name);
      }

      if (node.type === "PseudoClassSelector" && node.name === "global") {
        const selector = code.slice(node.start, node.end);
        const cleanSelector = selector.replace(GLOBAL_SELECTOR_REGEX, "$1");
        selectors.add(cleanSelector);
      }

      // A string may hold several classes (`"bx--a bx--b"`), a selector
      // (`".bx--a .bx--b"`), or markup, so add each class it names.
      for (const cls of literalClasses(node)) {
        selectors.add(cls);
      }

      if (node.type === "RegularElement" || node.type === "SvelteElement") {
        const classes: string[] = [];
        for (const attribute of node.attributes) {
          if (
            attribute.type === "ClassDirective" &&
            attribute.name.startsWith("bx--")
          ) {
            classes.push(`.${attribute.name}`);
          }
        }
        if (classes.length > 0) {
          openWrappers.push({ node, classes });
        }
      }

      if (node.type === "SlotElement") {
        for (const wrapper of openWrappers) {
          for (const cls of wrapper.classes) {
            slotWrappers.add(cls);
          }
        }
      }
    },
    leave(node) {
      if (node === openWrappers.at(-1)?.node) {
        openWrappers.pop();
      }
    },
  });

  if (ast.module) {
    walk(ast.module, {
      enter(node) {
        for (const cls of literalClasses(node, { skipLookups: true })) {
          moduleClasses.add(cls);
        }
      },
    });
  }

  const classes: string[] = [];

  for (const raw of selectors) {
    const value = raw.trim();
    classes.push(value.startsWith(".") ? value : `.${value}`);
  }

  return {
    classes: [...new Set(classes)],
    components: [...new Set(components)],
    slotWrappers: [...slotWrappers],
    imports: [
      ...new Set(
        relativeImports(
          [ast.module?.content, ast.instance?.content],
          moduleKey,
        ),
      ),
    ],
    runtimeClasses: extractRuntimeClassesFromSource(code),
    moduleClasses: [...moduleClasses],
  };
}
