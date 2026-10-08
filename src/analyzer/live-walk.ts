import type { AST, Expression } from "sveast/walk";
import { extractCarbonClassTokens } from "../indexer/extract-runtime-classes";
import { childNodes, lineAt, type Node } from "./ast";
import { UnsupportedComponentError } from "./component-model";
import {
  evaluate,
  type PassedProp,
  type Scope,
  spreadProps,
  whyUnknown,
} from "./evaluate";
import type { CallSite } from "./usage";
import {
  isEmptyArray,
  isNeverNullish,
  join,
  possible,
  stringify,
  type Truth,
  truthOf,
  UNDEFINED,
  UNKNOWN,
  type Value,
} from "./values";

/** What one component renders under its usage. */
export type LiveResult = {
  /** `.bx--*` classes it can apply. */
  classes: Set<string>;
  /** `.bx--*-` prefixes of classes built from values it can't bound. */
  prefixes: Set<string>;
  /** Carbon components it can render, with the props it passes them. */
  childSites: CallSite[];
};

function addTokens(text: string, result: LiveResult): void {
  if (!text.includes("bx--")) return;
  for (const token of extractCarbonClassTokens(text)) {
    if (token.endsWith("-")) result.prefixes.add(token);
    else result.classes.add(token);
  }
}

function addStrings(value: Value, result: LiveResult): void {
  if (value === UNKNOWN) return;
  for (const p of value) if (typeof p === "string") addTokens(p, result);
}

/**
 * Walks `scope.model`'s script and markup, skipping whatever its usage
 * proves can't run: the falsy side of `&&`, `||`, `??`, ternaries, `if`
 * statements, `{#if}` branches, `{#each}` over an array that stays empty,
 * and falsy `class:` directives. Everything
 * else is assumed live, including every function body.
 */
export function walkLive(scope: Scope): LiveResult {
  const result: LiveResult = {
    classes: new Set(),
    prefixes: new Set(),
    childSites: [],
  };
  const { ast } = scope.model;
  // Scripts first, then markup; `<style>` holds no rendered classes.
  for (const node of [ast.module, ast.instance, ast.fragment]) {
    if (node) visit(node, scope, result);
  }
  return result;
}

function visitAll(nodes: Iterable<Node>, scope: Scope, result: LiveResult) {
  for (const node of nodes) visit(node, scope, result);
}

function visitBranches(
  truth: Truth,
  consequent: Node | null | undefined,
  alternate: Node | null | undefined,
  scope: Scope,
  result: LiveResult,
): void {
  if (truth !== "falsy" && consequent) visit(consequent, scope, result);
  if (truth !== "truthy" && alternate) visit(alternate, scope, result);
}

function visit(node: Node, scope: Scope, result: LiveResult): void {
  switch (node.type) {
    // Import bindings aren't uses.
    case "ImportDeclaration":
      return;

    case "Literal":
      if (typeof node.value === "string") addTokens(node.value, result);
      return;

    case "TemplateLiteral": {
      if (node.quasis.some((quasi) => quasi.value.raw.includes("bx--"))) {
        const value = evaluate(node, scope);
        if (value !== UNKNOWN) {
          addStrings(value, result);
          visitAll(node.expressions as Node[], scope, result);
          return;
        }
      }
      break;
    }

    // A template the walk can't evaluate keeps its literal parts: the
    // `bx--btn--` in `bx--btn--${kind}` becomes a prefix.
    case "TemplateElement":
      addTokens(node.value.raw, result);
      return;

    case "Text":
      // Attribute text (`class="bx--a"`, `labelClass="bx--b"`); element
      // text never names a class, and skipping it here costs nothing.
      addTokens(node.data, result);
      return;

    case "Identifier": {
      // A component referenced as a value (`this={Comp}`, `const C = …`)
      // can render with any props.
      const key = scope.model.componentImports.get(node.name);
      if (key) {
        result.childSites.push({
          component: key,
          open: true,
          props: new Map(),
          slots: null,
        });
      }
      return;
    }

    case "LogicalExpression": {
      visit(node.left, scope, result);
      const left = evaluate(node.left, scope);
      const truth = truthOf(left);
      const skipRight =
        (node.operator === "&&" && truth === "falsy") ||
        (node.operator === "||" && truth === "truthy") ||
        (node.operator === "??" && isNeverNullish(left));
      if (!skipRight) visit(node.right, scope, result);
      return;
    }

    case "ConditionalExpression":
    case "IfStatement": {
      visit(node.test, scope, result);
      const truth = truthOf(evaluate(node.test, scope));
      visitBranches(truth, node.consequent, node.alternate, scope, result);
      return;
    }

    case "IfBlock": {
      visit(node.test, scope, result);
      const truth = truthOf(evaluate(node.test, scope));
      visitBranches(truth, node.consequent, node.alternate, scope, result);
      return;
    }

    case "EachBlock": {
      visit(node.expression, scope, result);
      // Over an array known to stay empty: only `{:else}` renders.
      if (isEmptyArray(evaluate(node.expression, scope))) {
        if (node.fallback) visit(node.fallback, scope, result);
        return;
      }
      break;
    }

    case "ClassDirective": {
      visit(node.expression, scope, result);
      const truth = truthOf(evaluate(node.expression, scope));
      if (truth !== "falsy") addTokens(node.name, result);
      return;
    }

    case "Component": {
      const key = scope.model.componentImports.get(node.name);
      // A tag bound to an import the model couldn't trace to a `.svelte`
      // file: whatever it renders is invisible to the walk.
      if (!key && scope.model.otherImports.has(node.name)) {
        throw new UnsupportedComponentError(
          `${scope.model.key} renders <${node.name}>, which couldn't be resolved`,
        );
      }
      if (key) {
        result.childSites.push(
          locateReason(
            callSiteFromElement(
              node,
              key,
              (expression) => evaluate(expression, scope),
              (argument) => spreadProps(argument, scope),
              explainAt(node, scope),
            ),
            node,
            scope,
          ),
        );
      }
      break;
    }

    case "SvelteSelf":
      result.childSites.push(
        callSiteFromElement(
          node,
          scope.model.key,
          (expression) => evaluate(expression, scope),
          (argument) => spreadProps(argument, scope),
          explainAt(node, scope),
        ),
      );
      break;
  }

  visitAll(childNodes(node), scope, result);
}

/** `Button.svelte:12`: where `node` is in the component `scope` walks. */
function whereIn(node: { start: number }, scope: Scope): string {
  return `${scope.model.key.split("/").pop()}:${lineAt(scope.model.code, node.start)}`;
}

/** Prefixes an open site's reason with where it is, for the report. */
function locateReason(
  site: CallSite,
  node: { start: number },
  scope: Scope,
): CallSite {
  if (site.open && site.reason) {
    site.reason = `${whereIn(node, scope)} ${site.reason}`;
  }
  return site;
}

/** Explains unknown values at `node`, prefixed with where it is. */
function explainAt(
  node: { start: number },
  scope: Scope,
): (expression: Expression) => string | undefined {
  const where = whereIn(node, scope);
  return (expression) => {
    const why = whyUnknown(expression, scope);
    return why && `${where} ${why}`;
  };
}

const MAX_ATTRIBUTE_VALUES = 32;

/** The value an attribute passes as a prop. */
function attributeValue(
  attribute: AST.Attribute,
  evaluateExpression: (expression: Expression) => Value,
): Value {
  const { value } = attribute;
  if (value === true) return possible(true);
  if (!Array.isArray(value)) return evaluateExpression(value.expression);
  if (value.length === 1 && value[0].type === "ExpressionTag") {
    // `prop="{x}"`: the value itself, or its string form.
    const inner = evaluateExpression(value[0].expression);
    return join(inner, stringify(inner));
  }
  let result: Value = possible("");
  for (const part of value) {
    const piece =
      part.type === "Text"
        ? possible(part.data)
        : stringify(evaluateExpression(part.expression));
    if (piece === UNKNOWN) return UNKNOWN;
    const next = new Set<string>();
    for (const a of result as ReadonlySet<string>) {
      for (const b of piece) next.add(a + String(b));
    }
    if (next.size > MAX_ATTRIBUTE_VALUES) return UNKNOWN;
    result = next;
  }
  return result;
}

const WHITESPACE_ONLY = /^\s*$/;

/** The slots an element's children fill; `null` if that can't be told. */
function filledSlots(fragment: AST.Fragment): Set<string> | null {
  const slots = new Set<string>();
  for (const child of fragment.nodes) {
    if (child.type === "Comment") continue;
    if (child.type === "Text" && WHITESPACE_ONLY.test(child.data)) continue;
    // Svelte 5 snippets can stand in for slots.
    if (child.type === "SnippetBlock") return null;
    const slot =
      "attributes" in child
        ? child.attributes.find(
            (attribute) =>
              attribute.type === "Attribute" && attribute.name === "slot",
          )
        : undefined;
    if (!slot) {
      slots.add("default");
      continue;
    }
    if (slot.type !== "Attribute" || !Array.isArray(slot.value)) return null;
    const [text] = slot.value;
    if (slot.value.length !== 1 || text.type !== "Text") return null;
    slots.add(text.data);
  }
  return slots;
}

function whyOf(site: CallSite): Map<string, string> {
  site.why ??= new Map();
  return site.why;
}

/** Why an attribute's value is unknown: its first unknown expression. */
function attributeWhy(
  attribute: AST.Attribute,
  explain: (expression: Expression) => string | undefined,
): string | undefined {
  const { value } = attribute;
  if (value === true) return undefined;
  const parts = Array.isArray(value) ? value : [value];
  for (const part of parts) {
    if (part.type === "Text") continue;
    const why = explain(part.expression);
    if (why) return why;
  }
  return undefined;
}

/**
 * A call site for `<Component …>`, its props evaluated by
 * `evaluateExpression`. `spread` gives the props a spread passes when it
 * can tell (the component's own `$$restProps`); any other spread makes
 * the site open.
 */
export function callSiteFromElement(
  node: AST.Component | AST.SvelteSelf,
  component: string,
  evaluateExpression: (expression: Expression) => Value,
  spread?: (argument: Expression) => Map<string, PassedProp> | undefined,
  /** Why an expression is unknown, for the report. */
  explain?: (expression: Expression) => string | undefined,
): CallSite {
  const site: CallSite = {
    component,
    open: false,
    props: new Map(),
    slots: filledSlots(node.fragment),
  };
  for (const attribute of node.attributes) {
    switch (attribute.type) {
      case "SpreadAttribute": {
        const props = spread?.(attribute.expression);
        if (!props) {
          site.open = true;
          site.reason = "spreads props";
          break;
        }
        // Where the spread lacks a key, the value set before it stays,
        // or the prop isn't passed at all.
        for (const [name, { value, maybeAbsent, why }] of props) {
          if (name === "slot" || name.startsWith("--")) continue;
          const before = site.props.get(name);
          site.props.set(
            name,
            maybeAbsent ? join(before ?? UNDEFINED, value) : value,
          );
          if (value === UNKNOWN && why) whyOf(site).set(name, why);
        }
        break;
      }
      case "Attribute":
        // `slot` places this element in its parent; `--x` sets a CSS variable.
        if (attribute.name === "slot" || attribute.name.startsWith("--")) break;
        {
          const value = attributeValue(attribute, evaluateExpression);
          site.props.set(attribute.name, value);
          const why =
            value === UNKNOWN && explain
              ? attributeWhy(attribute, explain)
              : undefined;
          if (why) whyOf(site).set(attribute.name, why);
        }
        break;
      case "BindDirective":
        site.props.set(attribute.name, UNKNOWN);
        whyOf(site).set(
          attribute.name,
          explain?.(attribute.expression as Expression) ??
            "is bound with `bind:`",
        );
        break;
    }
  }
  return site;
}
