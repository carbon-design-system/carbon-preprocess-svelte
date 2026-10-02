import type { Expression } from "sveast/walk";
import type { Node } from "./ast";
import { type ComponentModel, FUNCTION_DECLARATION } from "./component-model";
import type { ComponentUsage } from "./usage";
import {
  BOOLEAN,
  binary,
  flatMap,
  isNullish,
  isTruthy,
  join,
  OBJECT,
  possible,
  stringify,
  truthOf,
  UNDEFINED,
  UNKNOWN,
  type Value,
} from "./values";

/** What `getContext(key)` can return: `undefined` if nothing provides it. */
export type ContextResolver = (key: string) => Value;

/** One component being evaluated against its merged usage. */
export type Scope = {
  model: ComponentModel;
  usage: ComponentUsage;
  context: ContextResolver;
  memo: Map<string, Value>;
  /** Names being evaluated, so a cycle reads as unknown instead of looping. */
  pending: Set<string>;
};

export function createScope(
  model: ComponentModel,
  usage: ComponentUsage,
  context: ContextResolver,
): Scope {
  return { model, usage, context, memo: new Map(), pending: new Set() };
}

function lookup(name: string, scope: Scope): Value {
  if (name === "undefined") return UNDEFINED;
  const { model } = scope;
  if (model.unknownNames.has(name)) return UNKNOWN;
  const cached = scope.memo.get(name);
  if (cached !== undefined) return cached;
  if (scope.pending.has(name)) return UNKNOWN;

  scope.pending.add(name);
  const value = resolve(name, scope);
  scope.pending.delete(name);
  scope.memo.set(name, value);
  return value;
}

function resolve(name: string, scope: Scope): Value {
  const { model, usage } = scope;

  if (model.props.has(name)) {
    if (usage.open) return UNKNOWN;
    const fallback = model.props.get(name);
    const defaultValue = fallback ? evaluate(fallback, scope) : UNDEFINED;
    const given = usage.props.get(name);
    if (given === undefined) return defaultValue;
    // A prop passed as `undefined` falls back to its default.
    const passesUndefined = given === UNKNOWN || given.has(undefined);
    return usage.omitted.has(name) || passesUndefined
      ? join(given, defaultValue)
      : given;
  }

  const declaration = model.declarations.get(name);
  if (declaration === FUNCTION_DECLARATION) return possible(OBJECT);
  if (declaration !== undefined) {
    return declaration ? evaluate(declaration, scope) : UNDEFINED;
  }
  if (model.declarations.has(name)) return UNDEFINED;

  if (model.componentImports.has(name)) return possible(OBJECT);

  // `$store` reads a store's value: `undefined` only if the store itself is.
  if (name.startsWith("$") && !name.startsWith("$$") && name.length > 1) {
    const store = lookup(name.slice(1), scope);
    return isOnly(store, undefined) ? UNDEFINED : UNKNOWN;
  }

  return UNKNOWN;
}

function isOnly(value: Value, p: undefined): boolean {
  return value !== UNKNOWN && value.size === 1 && value.has(p);
}

/** Every value `node` can evaluate to under `scope`. */
export function evaluate(node: Node | Expression, scope: Scope): Value {
  switch (node.type) {
    case "Literal":
      return "regex" in node && node.regex
        ? possible(OBJECT)
        : typeof node.value === "bigint"
          ? UNKNOWN
          : possible(node.value as string | number | boolean | null);

    case "Identifier":
      return lookup(node.name, scope);

    case "TemplateLiteral": {
      let result: Value = possible(node.quasis[0].value.cooked ?? "");
      for (const [i, expression] of node.expressions.entries()) {
        result = binary(
          "+",
          result,
          stringify(evaluate(expression as Expression, scope)),
        );
        result = binary(
          "+",
          result,
          possible(node.quasis[i + 1].value.cooked ?? ""),
        );
      }
      return result;
    }

    case "LogicalExpression": {
      const right = () => evaluate(node.right, scope);
      return flatMap(evaluate(node.left, scope), (p) => {
        if (node.operator === "&&") return isTruthy(p) ? right() : possible(p);
        if (node.operator === "||") return isTruthy(p) ? possible(p) : right();
        return isNullish(p) ? right() : possible(p);
      });
    }

    case "ConditionalExpression": {
      const truth = truthOf(evaluate(node.test, scope));
      if (truth === "truthy") return evaluate(node.consequent, scope);
      if (truth === "falsy") return evaluate(node.alternate, scope);
      return join(
        evaluate(node.consequent, scope),
        evaluate(node.alternate, scope),
      );
    }

    case "UnaryExpression": {
      if (node.operator === "void") return UNDEFINED;
      if (node.operator !== "!") return UNKNOWN;
      const truth = truthOf(evaluate(node.argument, scope));
      return truth === "either" ? BOOLEAN : possible(truth === "falsy");
    }

    case "BinaryExpression":
      return binary(
        node.operator,
        evaluate(node.left as Expression, scope),
        evaluate(node.right, scope),
      );

    case "SequenceExpression":
      return evaluate(node.expressions[node.expressions.length - 1], scope);

    case "CallExpression":
      return evaluateCall(node, scope);

    case "MemberExpression":
      return evaluateMember(node, scope);

    case "ChainExpression":
      return evaluate(node.expression, scope);

    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "TSTypeAssertion":
      return evaluate(node.expression as Expression, scope);

    case "ArrayExpression":
    case "ObjectExpression":
    case "ArrowFunctionExpression":
    case "FunctionExpression":
    case "ClassExpression":
    case "NewExpression":
      return possible(OBJECT);

    default:
      return UNKNOWN;
  }
}

function evaluateCall(
  node: Extract<Node, { type: "CallExpression" }>,
  scope: Scope,
): Value {
  const { callee, arguments: args } = node;
  if (
    callee.type !== "Identifier" ||
    scope.model.unknownNames.has(callee.name)
  ) {
    return UNKNOWN;
  }
  const [first] = args;
  const argument = () =>
    first && first.type !== "SpreadElement" ? evaluate(first, scope) : UNKNOWN;

  switch (callee.name) {
    case "Boolean": {
      const truth = truthOf(argument());
      return truth === "either" ? BOOLEAN : possible(truth === "truthy");
    }
    case "String":
      return stringify(argument());
    case "getContext":
      return first?.type === "Literal" && typeof first.value === "string"
        ? scope.context(first.value)
        : UNKNOWN;
    default:
      return UNKNOWN;
  }
}

function evaluateMember(
  node: Extract<Node, { type: "MemberExpression" }>,
  scope: Scope,
): Value {
  const { object, property, computed, optional } = node;
  if (object.type === "Identifier") {
    if (
      object.name === "$$slots" &&
      !computed &&
      property.type === "Identifier"
    ) {
      const { usage } = scope;
      if (usage.open || usage.slotsUnknown) return UNKNOWN;
      return usage.slots.get(property.name) ?? UNDEFINED;
    }
    if (object.name === "$$props" || object.name === "$$restProps") {
      return UNKNOWN;
    }
  }
  if (object.type === "Super") return UNKNOWN;
  // `undefined?.x` is `undefined`; anything else is beyond this model.
  const target = evaluate(object, scope);
  return optional && isOnly(target, undefined) ? UNDEFINED : UNKNOWN;
}
