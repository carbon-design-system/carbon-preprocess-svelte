import type { Binding } from "sveast/scope";
import {
  type Expression,
  type Identifier,
  skipTypeWrappers,
} from "sveast/walk";
import type { Node } from "./ast";
import {
  type ComponentModel,
  FUNCTION_DECLARATION,
  isTopLevel,
} from "./component-model";
import type { ComponentUsage } from "./usage";
import {
  BOOLEAN,
  binary,
  EMPTY_ARRAY,
  flatMap,
  isNullish,
  isObject,
  isShape,
  isStore,
  isStructured,
  isTruthy,
  itemsOf,
  join,
  MAX_SHAPE_SIZE,
  OBJECT,
  possible,
  readProperty,
  shape,
  store,
  stringify,
  truthOf,
  typeOf,
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
  /**
   * What the enclosing `{#each}` blocks' items hold. Replaced, never
   * mutated, while walking a body.
   */
  locals: ReadonlyMap<Binding, Value>;
  /** Values of imported names, when known (the app's own constants). */
  imported: ReadonlyMap<string, Value>;
};

const NO_LOCALS: ReadonlyMap<Binding, Value> = new Map();
const NO_IMPORTS: ReadonlyMap<string, Value> = new Map();

export function createScope(
  model: ComponentModel,
  usage: ComponentUsage,
  context: ContextResolver,
  imported: ReadonlyMap<string, Value> = NO_IMPORTS,
): Scope {
  return {
    model,
    usage,
    context,
    memo: new Map(),
    pending: new Set(),
    locals: NO_LOCALS,
    imported,
  };
}

/**
 * The binding `node` refers to when a nested scope declares it (a
 * parameter, a local, an `{#each}` item, `let:`, a snippet parameter,
 * `{@const}`, an `{#await}` value); `undefined` for the component's own
 * names and globals, which are read by name.
 */
function nestedBinding(node: Identifier, scope: Scope): Binding | undefined {
  const binding = scope.model.scopes.bindingOf(node);
  return binding && !isTopLevel(binding, scope.model) ? binding : undefined;
}

/** What `node` holds: an `{#each}` item's value, or the name's. */
function evaluateIdentifier(node: Identifier, scope: Scope): Value {
  const nested = nestedBinding(node, scope);
  if (!nested) return lookup(node.name, scope);
  // `$item` reads a store a nested binding holds: unknown.
  return nested.name === node.name
    ? (scope.locals.get(nested) ?? UNKNOWN)
    : UNKNOWN;
}

/** What the component's own name `name` (or a global) holds. */
function lookup(name: string, scope: Scope): Value {
  if (name === "undefined") return UNDEFINED;
  const { model } = scope;
  if (model.unknownNames.has(name)) return UNKNOWN;
  const cached = scope.memo.get(name);
  if (cached !== undefined) return cached;
  if (scope.pending.has(name)) return UNKNOWN;

  scope.pending.add(name);
  let value: Value;
  try {
    value = keepIfContained(resolve(name, scope), name, model);
  } finally {
    scope.pending.delete(name);
  }
  scope.memo.set(name, value);
  return value;
}

/**
 * `value` with its known objects and arrays (`[]`, shapes) widened to
 * some object, unless nothing can mutate them: the name isn't passed on
 * or written through, and every property path read from it that reaches
 * an object stays in sight. See `ComponentModel.escapes`.
 */
function keepIfContained(
  value: Value,
  name: string,
  model: ComponentModel,
): Value {
  if (value === UNKNOWN || ![...value].some(isStructured)) return value;
  const own = model.escapes.get(name);
  const passedAs = model.propNames.get(name) ?? name;
  const contained =
    !model.escapes.get("*")?.full &&
    !model.escapes.get(`$$props.${passedAs}`)?.full &&
    !own?.full &&
    !(own?.paths ?? []).some((path) => mayReachObject(value, path));
  return contained
    ? value
    : flatMap(value, (p) => possible(isStructured(p) ? OBJECT : p));
}

/** Whether reading `path` from `value` can give an object (or something unknown). */
function mayReachObject(value: Value, path: readonly string[]): boolean {
  let current = value;
  for (const segment of path) {
    current =
      segment === "[]"
        ? itemsOf(current)
        : segment === "*"
          ? UNKNOWN
          : flatMap(current, (p) => readProperty(p, segment));
    if (current === UNKNOWN) return true;
  }
  return current === UNKNOWN || [...current].some(isObject);
}

/**
 * Binds the item (and index) of `{#each}` `node` while its body is walked;
 * returns a function that unbinds them.
 */
export function bindEach(
  node: Extract<Node, { type: "EachBlock" }>,
  scope: Scope,
): () => void {
  const items = itemsOf(evaluate(node.expression, scope));
  const outer = scope.locals;
  const locals = new Map(outer);
  bindPattern(node.context as Node | null, items, locals, scope);
  scope.locals = locals;
  return () => {
    scope.locals = outer;
  };
}

/**
 * Binds the names `pattern` declares to what it reads from `value`, where
 * that's a plain property; the others, and the index, stay unknown.
 */
function bindPattern(
  pattern: Node | null,
  value: Value,
  locals: Map<Binding, Value>,
  scope: Scope,
): void {
  const bind = (node: Identifier, bound: Value) => {
    const binding = scope.model.scopes.bindingOf(node);
    if (binding) locals.set(binding, bound);
  };
  if (pattern?.type === "Identifier") {
    bind(pattern, value);
    return;
  }
  if (pattern?.type !== "ObjectPattern") return;
  for (const property of pattern.properties) {
    const key =
      property.type === "Property" && !property.computed
        ? property.key.type === "Identifier"
          ? property.key.name
          : property.key.type === "Literal"
            ? String(property.key.value)
            : undefined
        : undefined;
    if (
      key !== undefined &&
      property.type === "Property" &&
      property.value.type === "Identifier"
    ) {
      bind(
        property.value,
        flatMap(value, (p) => readProperty(p, key)),
      );
    }
  }
}

function resolve(name: string, scope: Scope): Value {
  const { model, usage } = scope;

  if (model.props.has(name)) {
    if (usage.open) return UNKNOWN;
    const fallback = model.props.get(name);
    const defaultValue = fallback ? evaluate(fallback, scope) : UNDEFINED;
    // The name the parent passes it by (`class` for `className`).
    const passedAs = model.propNames.get(name) ?? name;
    const given = usage.props.get(passedAs);
    if (given === undefined) return defaultValue;
    // A prop passed as `undefined` falls back to its default.
    const passesUndefined = given === UNKNOWN || given.has(undefined);
    return usage.omitted.has(passedAs) || passesUndefined
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
  const imported = scope.imported.get(name);
  if (imported && model.otherImports.has(name)) return imported;

  // `$store` reads a store's value: `undefined` if the store itself is,
  // and a `readable` one's never changes.
  if (name.startsWith("$") && !name.startsWith("$$") && name.length > 1) {
    const holder = lookup(name.slice(1), scope);
    if (isOnly(holder, undefined)) return UNDEFINED;
    return flatMap(holder, (p) => (isStore(p) ? p.value : UNKNOWN));
  }

  return UNKNOWN;
}

function isOnly(value: Value, p: undefined): boolean {
  return value !== UNKNOWN && value.size === 1 && value.has(p);
}

/** `$$props`, `$$restProps`, or the rest of `$props()`. */
export function isPropsObject(node: Identifier, scope: Scope): boolean {
  const { name } = node;
  return (
    (name === "$$props" ||
      name === "$$restProps" ||
      name === scope.model.restPropsName) &&
    !nestedBinding(node, scope)
  );
}

/**
 * A key of `$$props`: the values sites pass, whether some site leaves it
 * out, and why it's unknown when it is.
 */
export type PassedProp = { value: Value; maybeAbsent: boolean; why?: string };

/**
 * What `$$props` holds (or `$$restProps`, with `rest`: only the keys the
 * component doesn't declare): every key a call site passes. `undefined`
 * when some site spreads props or the component is used as a value.
 */
export function passedProps(
  scope: Scope,
  rest: boolean,
): Map<string, PassedProp> | undefined {
  const { model, usage } = scope;
  if (usage.open) return undefined;
  const declared = new Set(rest ? model.propNames.values() : []);
  const props = new Map<string, PassedProp>();
  for (const [key, value] of usage.props) {
    if (declared.has(key)) continue;
    props.set(key, {
      value,
      maybeAbsent: usage.omitted.has(key),
      why: usage.unknownBecause.get(key),
    });
  }
  return props;
}

/** The props a spread on a child passes, if it spreads the component's own props. */
export function spreadProps(
  argument: Expression,
  scope: Scope,
): Map<string, PassedProp> | undefined {
  if (argument.type === "Identifier" && isPropsObject(argument, scope)) {
    return passedProps(scope, argument.name !== "$$props");
  }
  return spreadObjects(evaluate(argument, scope));
}

/**
 * The props spreading `value` passes, when each value it can be is an
 * object literal (or `null`/`undefined`, which pass nothing): a key some
 * of them lack may be absent.
 */
function spreadObjects(value: Value): Map<string, PassedProp> | undefined {
  if (value === UNKNOWN || value.size === 0) return undefined;
  const objects: Array<ReadonlyMap<string, Value>> = [];
  for (const p of value) {
    if (p === undefined || p === null) objects.push(new Map());
    else if (isShape(p) && p.kind === "object") objects.push(p.props);
    else return undefined;
  }
  const props = new Map<string, PassedProp>();
  for (const object of objects) {
    for (const [key, propValue] of object) {
      const passed = props.get(key);
      props.set(key, {
        value: passed ? join(passed.value, propValue) : propValue,
        maybeAbsent: false,
      });
    }
  }
  for (const [key, passed] of props) {
    passed.maybeAbsent = objects.some((object) => !object.has(key));
  }
  return props;
}

const MAX_WHY_DEPTH = 8;
const PATH_SEPARATOR = /[\\/]/;
const MAX_SNIPPET = 40;

/** `node`'s source, shortened for a report line. */
function snippet(node: Node | Expression, scope: Scope): string {
  const { start, end } = node as unknown as { start: number; end: number };
  const text = scope.model.code.slice(start, end).replace(/\s+/g, " ");
  return text.length > MAX_SNIPPET
    ? `${text.slice(0, MAX_SNIPPET - 1)}…`
    : text;
}

/**
 * Why `node` evaluates to unknown under `scope`, for the report: the
 * first part of it the analysis can't read. `undefined` when it's known.
 */
export function whyUnknown(
  node: Node | Expression,
  scope: Scope,
  depth = 0,
): string | undefined {
  if (depth > MAX_WHY_DEPTH || evaluate(node, scope) !== UNKNOWN) {
    return undefined;
  }
  const inner = (child: Node | Expression | null | undefined) =>
    child ? whyUnknown(child, scope, depth + 1) : undefined;
  switch (node.type) {
    case "Identifier": {
      const nested = nestedBinding(node, scope);
      return nested
        ? `\`${node.name}\` ${NESTED_REASONS[nested.kind] ?? "is declared in a nested scope"}`
        : whyNameUnknown(node.name, scope, depth);
    }
    case "CallExpression":
      return `calls \`${snippet(node.callee as Expression, scope)}()\``;
    case "MemberExpression":
      return `reads \`${snippet(node, scope)}\``;
    case "TemplateLiteral":
      for (const expression of node.expressions) {
        const why = inner(expression as Expression);
        if (why) return why;
      }
      break;
    case "BinaryExpression":
    case "LogicalExpression":
      return inner(node.left as Expression) ?? inner(node.right);
    case "ConditionalExpression":
      return (
        inner(node.test) ?? inner(node.consequent) ?? inner(node.alternate)
      );
    case "UnaryExpression":
      return inner(node.argument);
    case "ChainExpression":
      return inner(node.expression);
  }
  return `\`${snippet(node, scope)}\` isn't read by the analysis`;
}

/**
 * `whyUnknown`, worked out only when asked: with the `{#each}` bindings in
 * place now, which a walk has moved past by then.
 */
export function whyUnknownLater(
  node: Node | Expression,
  scope: Scope,
): () => string | undefined {
  const locals = scope.locals;
  return () => {
    const current = scope.locals;
    scope.locals = locals;
    try {
      return whyUnknown(node, scope);
    } finally {
      scope.locals = current;
    }
  };
}

/** Why a nested binding of each kind is unknown, for the report. */
const NESTED_REASONS: Partial<Record<Binding["kind"], string>> = {
  param: "is a parameter",
  "snippet-param": "is a snippet parameter",
  each: "is an `{#each}` item the analysis can't read",
  "each-index": "is an `{#each}` index",
  "let-directive": "comes from a slot (`let:`)",
  "const-tag": "is declared by `{@const}`",
  "await-value": "is what an `{#await}` resolves to",
  "await-error": "is what an `{#await}` rejects with",
};

function whyNameUnknown(name: string, scope: Scope, depth: number): string {
  const { model, usage } = scope;
  const component = model.key.split(PATH_SEPARATOR).pop() ?? model.key;
  const reason = model.unknownReasons.get(name);
  if (reason) return `\`${name}\` ${reason}`;
  if (model.props.has(name)) {
    if (usage.open) {
      return `\`${name}\` is a prop of ${component}, which is rendered with any props${usage.openReason ? ` (${usage.openReason})` : ""}`;
    }
    const passedAs = model.propNames.get(name) ?? name;
    const because = usage.unknownBecause.get(passedAs);
    return because
      ? `\`${name}\` comes from ${because}`
      : `\`${name}\` is passed a value the analysis can't read`;
  }
  const declaration = model.declarations.get(name);
  if (declaration && declaration !== FUNCTION_DECLARATION) {
    const why = whyUnknown(declaration, scope, depth + 1);
    if (why) return `\`${name}\`: ${why}`;
  }
  if (model.otherImports.has(name)) return `\`${name}\` is imported`;
  if (name.startsWith("$") && !name.startsWith("$$")) {
    return `\`${name}\` reads a store`;
  }
  return `\`${name}\` isn't declared in ${component}`;
}

/** Every value `node` can evaluate to under `scope`. */
export function evaluate(node: Node | Expression, scope: Scope): Value {
  const value = skipTypeWrappers(node);
  if (value !== node) return evaluate(value, scope);
  switch (node.type) {
    case "Literal":
      return "regex" in node && node.regex
        ? possible(OBJECT)
        : typeof node.value === "bigint"
          ? UNKNOWN
          : possible(node.value as string | number | boolean | null);

    case "Identifier":
      return evaluateIdentifier(node, scope);

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
      if (node.operator === "typeof") {
        return typeOf(evaluate(node.argument, scope));
      }
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

    case "ArrayExpression":
      // Fresh: known until something that holds it changes it.
      if (node.elements.length === 0) return possible(EMPTY_ARRAY);
      if (
        node.elements.length > MAX_SHAPE_SIZE ||
        node.elements.some((element) => element?.type === "SpreadElement")
      ) {
        return possible(OBJECT);
      }
      return possible(
        shape({
          kind: "array",
          elements: node.elements.map((element) =>
            element ? evaluate(element as Expression, scope) : UNDEFINED,
          ),
        }),
      );

    case "ObjectExpression":
      return objectShape(node, scope);

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
    scope.model.unknownNames.has(callee.name) ||
    nestedBinding(callee, scope)
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
    default: {
      // `readable(value)` with no start function: a store that never
      // changes. One holding an object could have it mutated through `$`.
      if (
        scope.model.storeImports.get(callee.name) === "readable" &&
        args.length <= 1
      ) {
        const value = first ? argument() : UNDEFINED;
        return possible(
          store(
            value !== UNKNOWN && [...value].some(isObject) ? UNKNOWN : value,
          ),
        );
      }
      const fn = knownFunction(callee.name, scope);
      return fn ? returnValue(fn, scope) : UNKNOWN;
    }
  }
}

type FunctionNode = Extract<
  Node,
  { type: "ArrowFunctionExpression" | "FunctionExpression" }
>;

/**
 * The function the component's own name `name` holds, when the analysis
 * can read its body: a prop's default no call site overrides, or a
 * top-level `const f = (…) => …`.
 */
function knownFunction(name: string, scope: Scope): FunctionNode | undefined {
  const { model, usage } = scope;
  let node: Node | null | undefined;
  if (model.props.has(name)) {
    const passedAs = model.propNames.get(name) ?? name;
    if (usage.open || usage.props.has(passedAs)) return undefined;
    node = model.props.get(name) as Node | null | undefined;
  } else {
    const declaration = model.declarations.get(name);
    if (declaration === FUNCTION_DECLARATION) return undefined;
    node = declaration as Node | null | undefined;
  }
  if (
    (node?.type === "ArrowFunctionExpression" ||
      node?.type === "FunctionExpression") &&
    !node.async &&
    !node.generator
  ) {
    return node;
  }
  return undefined;
}

/**
 * What calling `fn` returns, when its body is an expression or a lone
 * `return`: its parameters are unknown (they're nested bindings), and
 * every other name it reads is the component's own (it's declared at the
 * top level).
 */
function returnValue(fn: FunctionNode, scope: Scope): Value {
  let returned: Node | null;
  if (fn.body.type === "BlockStatement") {
    const statements = fn.body.body as Node[];
    if (statements.length === 0) return UNDEFINED;
    const [only] = statements;
    if (statements.length > 1 || only.type !== "ReturnStatement") {
      return UNKNOWN;
    }
    returned = only.argument as Node | null;
  } else {
    returned = fn.body as Node;
  }
  if (!returned) return UNDEFINED;

  const key = `call:${(fn as { start?: number }).start}`;
  if (scope.pending.has(key)) return UNKNOWN;
  scope.pending.add(key);
  try {
    return evaluate(returned as Expression, scope);
  } finally {
    scope.pending.delete(key);
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
    if (isPropsObject(object, scope)) {
      const key =
        !computed && property.type === "Identifier"
          ? property.name
          : computed &&
              property.type === "Literal" &&
              typeof property.value === "string"
            ? property.value
            : undefined;
      const props =
        key === undefined
          ? undefined
          : passedProps(scope, object.name !== "$$props");
      const prop = props?.get(key as string);
      if (!props) return UNKNOWN;
      if (!prop) return UNDEFINED;
      return prop.maybeAbsent ? join(prop.value, UNDEFINED) : prop.value;
    }
  }
  if (object.type === "Super") return UNKNOWN;
  const target = evaluate(object, scope);
  // `undefined?.x` is `undefined`.
  if (optional && isOnly(target, undefined)) return UNDEFINED;
  const key = computed
    ? singleKey(evaluate(property as Expression, scope))
    : property.type === "Identifier"
      ? property.name
      : undefined;
  if (key === undefined) return UNKNOWN;
  // A known object's own properties and elements, a string's `length`;
  // anything else (`null.x` throws, a getter may run) is beyond this model.
  return flatMap(target, (p) =>
    optional && isNullish(p) ? UNDEFINED : readProperty(p, key),
  );
}

/** The one string or number key `value` holds, as a property name. */
function singleKey(value: Value): string | undefined {
  if (value === UNKNOWN || value.size !== 1) return undefined;
  const [p] = value;
  return typeof p === "string" || typeof p === "number" ? String(p) : undefined;
}

/** An object literal's shape, or some object if it has spreads, getters or computed keys. */
function objectShape(
  node: Extract<Node, { type: "ObjectExpression" }>,
  scope: Scope,
): Value {
  if (node.properties.length > MAX_SHAPE_SIZE) return possible(OBJECT);
  const props = new Map<string, Value>();
  for (const property of node.properties) {
    if (property.type !== "Property" || property.kind !== "init") {
      return possible(OBJECT);
    }
    const key = property.computed
      ? property.key.type === "Literal"
        ? String(property.key.value)
        : undefined
      : property.key.type === "Identifier"
        ? property.key.name
        : property.key.type === "Literal"
          ? String(property.key.value)
          : undefined;
    if (key === undefined || key === "__proto__") return possible(OBJECT);
    props.set(key, evaluate(property.value as Expression, scope));
  }
  return possible(shape({ kind: "object", props }));
}
