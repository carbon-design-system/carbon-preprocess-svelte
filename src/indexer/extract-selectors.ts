import { lexStrings } from "sveast/lexer";
import { type AST, walk } from "sveast/walk";
import { parse } from "../specializer/parser";
import {
  componentImports,
  extractCarbonClassTokens,
  extractRuntimeClassesFromSource,
} from "./extract-runtime-classes";

const WHITESPACE_REGEX = /\s+/;
const GLOBAL_SELECTOR_REGEX = /^:global\((.*)\)$/;

export type ExtractFromSvelteResult = {
  classes: string[];
  components: string[];
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
function literalClasses(node: AST.SvelteNode): string[] {
  if (node.type === "Literal" && typeof node.value === "string") {
    return extractCarbonClassTokens(node.value);
  }
  if (node.type === "TemplateElement") {
    return extractCarbonClassTokens(node.value.raw);
  }
  return [];
}

/**
 * The text of each string and template literal in a script, as
 * `literalClasses` reads it: a string's value, a template's raw text.
 * Lexed instead of parsed, since the indexer needs nothing else from the
 * script's AST.
 */
function scriptStrings(code: string, script: AST.Script | null | undefined) {
  if (!script) return [];
  const text = code.slice(script.content.start, script.content.end);
  return lexStrings(text).flatMap((string) =>
    string.kind === "template"
      ? [text.slice(string.start, string.end)]
      : string.value === null
        ? []
        : [string.value],
  );
}

export function extractFromSvelte(props: {
  code: string;
  filename: string;
}): ExtractFromSvelteResult {
  const { code, filename } = props;
  const moduleKey = filename.replace(/\\/g, "/");
  const ast = parse(code, { comments: false, script: false });
  const selectors = new Set<string>();
  const components = new Set<string>();
  const moduleClasses = new Set<string>();

  const moduleStrings = scriptStrings(code, ast.module);
  for (const text of [...moduleStrings, ...scriptStrings(code, ast.instance)]) {
    for (const cls of extractCarbonClassTokens(text)) selectors.add(cls);
  }
  for (const text of moduleStrings) {
    for (const cls of extractCarbonClassTokens(text, { skipLookups: true })) {
      moduleClasses.add(cls);
    }
  }

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

      // A string may hold several classes, a selector, or markup.
      for (const cls of literalClasses(node)) selectors.add(cls);
    },
  });

  const classes = new Set<string>();

  for (const raw of selectors) {
    const value = raw.trim();
    classes.add(value.startsWith(".") ? value : `.${value}`);
  }

  return {
    classes: [...classes],
    components: [...components],
    imports: [...new Set(componentImports(code, ast, moduleKey))],
    runtimeClasses: extractRuntimeClassesFromSource(code),
    moduleClasses: [...moduleClasses],
  };
}
