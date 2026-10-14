import type { Binding } from "sveast/scope";
import {
  type Expression,
  type Identifier,
  skipTypeWrappers,
} from "sveast/walk";
import type { Node } from "./ast";
import {
  type ComponentModel,
  contextKey,
  FUNCTION_DECLARATION,
  type FunctionNode,
  type GuardedWrite,
  isTopLevel,
  memberKey,
  propertyName,
} from "./component-model";
import { type ComponentUsage, newComponentUsage } from "./usage";
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
  type Primitive,
  possible,
  readProperty,
  shape,
  storeOf,
  stringify,
  truthOf,
  typeOf,
  UNDEFINED,
  UNKNOWN,
  type Value,
  valueKey,
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
  /** Major version of the Svelte the app compiles with, if known. */
  svelteMajor: number | undefined;
};

const NO_LOCALS: ReadonlyMap<Binding, Value> = new Map();
const NO_IMPORTS: ReadonlyMap<string, Value> = new Map();

export function createScope(
  model: ComponentModel,
  usage: ComponentUsage,
  context: ContextResolver,
  options: {
    imported?: ReadonlyMap<string, Value>;
    svelteMajor?: number;
  } = {},
): Scope {
  return {
    model,
    usage,
    context,
    memo: new Map(),
    pending: new Set(),
    locals: NO_LOCALS,
    imported: options.imported ?? NO_IMPORTS,
    svelteMajor: options.svelteMajor,
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
    value = keepIfContained(
      withGuardedWrites(resolve(name, scope), name, scope),
      name,
      model,
    );
  } finally {
    scope.pending.delete(name);
  }
  scope.memo.set(name, value);
  return value;
}

/**
 * `value` joined with what `name`'s guarded writes can assign: each write
 * whose conditions can all hold. Unknown if a write assigns something
 * unknown or an object.
 */
function withGuardedWrites(value: Value, name: string, scope: Scope): Value {
  const writes = scope.model.guardedWrites.get(name);
  if (!writes || value === UNKNOWN) return value;
  for (const write of liveWrites(writes, scope)) {
    const written = evaluate(write.value, scope);
    if (written === UNKNOWN || [...written].some(isObject)) return UNKNOWN;
    value = join(value, written);
  }
  return value;
}

/** The writes in `writes` whose `if` conditions can all hold. */
function liveWrites(writes: GuardedWrite[], scope: Scope): GuardedWrite[] {
  return writes.filter(({ guards }) =>
    guards.every(({ test, holds }) => {
      const truth = truthOf(evaluate(test, scope));
      return truth === "either" || (truth === "truthy") === holds;
    }),
  );
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
  return contained ? value : withoutContents(value);
}

/** `value` with each object whose contents are known as just some object. */
function withoutContents(value: Value): Value {
  return flatMap(value, (p) => possible(isStructured(p) ? OBJECT : p));
}

/** Whether reading `path` from `value` can give an object (or something unknown). */
function mayReachObject(value: Value, path: readonly string[]): boolean {
  let current = value;
  for (const segment of path) {
    current =
      segment === "[]"
        ? itemsOf(current)
        : segment === "*"
          ? flatMap(current, ownValues)
          : // Nothing is reachable from `null` or `undefined`.
            flatMap(current, (p) =>
              isNullish(p) ? UNDEFINED : readProperty(p, segment),
            );
    if (current === UNKNOWN) return true;
  }
  // A store's value already counts every write anyone can make to it.
  return (
    current === UNKNOWN || [...current].some((p) => isObject(p) && !isStore(p))
  );
}

/**
 * What reading any key of `p` can give (`obj[key]`): a known object's or
 * array's own values, `undefined` past them, or anything.
 */
function ownValues(p: Primitive): Value {
  if (isNullish(p)) return UNDEFINED;
  if (!isShape(p)) return UNKNOWN;
  let value = UNDEFINED;
  for (const own of p.kind === "object" ? p.props.values() : p.elements) {
    value = join(value, own);
  }
  return value;
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

  if (model.componentImports.has(name)) return possible(OBJECT);
  const imported = scope.imported.get(name);
  if (imported && model.otherImports.has(name)) return imported;

  // `$store` reads a store's value: `undefined` if the store itself is
  // (Svelte doesn't subscribe to a missing store), and a `readable` one's
  // never changes.
  if (name.startsWith("$") && !name.startsWith("$$") && name.length > 1) {
    return flatMap(lookup(name.slice(1), scope), (p) =>
      isNullish(p) ? UNDEFINED : isStore(p) ? p.value : UNKNOWN,
    );
  }

  return UNKNOWN;
}

function isOnlyUndefined(value: Value): boolean {
  return value !== UNKNOWN && value.size === 1 && value.has(undefined);
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
 * What props object `name` holds: for `$$props`, every key a call site
 * passes; for `$$restProps` and the rest of `$props()`, only the keys the
 * component doesn't declare. `undefined` when some site spreads props or
 * the component is used as a value.
 */
function passedProps(
  scope: Scope,
  name: string,
): Map<string, PassedProp> | undefined {
  const { model, usage } = scope;
  if (usage.open) return undefined;
  const rest = name !== "$$props";
  const declared = new Set(rest ? model.propNames.values() : []);
  // Svelte 5 leaves `children` out of `$$props` and `$$restProps` (not
  // out of the rest of `$props()`).
  const legacy = name !== model.restPropsName;
  const props = new Map<string, PassedProp>();
  for (const [key, value] of usage.props) {
    if (declared.has(key)) continue;
    let maybeAbsent = usage.omitted.has(key);
    if (legacy && key === "children") {
      const { svelteMajor } = scope;
      if (svelteMajor === undefined) maybeAbsent = true;
      else if (svelteMajor >= 5) continue;
    }
    props.set(key, {
      value,
      maybeAbsent,
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
    return passedProps(scope, argument.name);
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
function whyUnknown(
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
  const writes = model.guardedWrites.get(name);
  const write = writes && liveWrites(writes, scope)[0];
  if (write && lookup(name, scope) === UNKNOWN) {
    return `\`${name}\` is assigned at line ${write.line}`;
  }
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
    case "getContext": {
      const key = contextKey(first as Node | undefined, scope.model);
      return key === undefined ? UNKNOWN : scope.context(key);
    }
    default: {
      // `readable(value)` with no start function: a store that never changes.
      if (
        scope.model.storeImports.get(callee.name) === "readable" &&
        args.length <= 1
      ) {
        return storeOf(first ? argument() : UNDEFINED);
      }
      const fn = knownFunction(callee.name, scope);
      if (fn) return callValue(fn, args as Node[], scope, scope);
      const helper = scope.model.importedHelpers.get(callee.name)?.();
      if (!helper) return UNKNOWN;
      return callValue(
        helper.fn,
        args as Node[],
        scope,
        createScope(helper.model, newComponentUsage(), () => UNKNOWN),
      );
    }
  }
}

/**
 * The function the component's own name `name` holds, when the analysis
 * can read its body: a prop's default no call site overrides, a
 * top-level `const f = (…) => …`, or a `function` declaration.
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
    node =
      declaration === FUNCTION_DECLARATION
        ? model.functions.get(name)
        : (declaration as Node | null | undefined);
  }
  if (
    (node?.type === "ArrowFunctionExpression" ||
      node?.type === "FunctionExpression" ||
      node?.type === "FunctionDeclaration") &&
    !node.async &&
    !node.generator
  ) {
    return node;
  }
  return undefined;
}

/** Calls nested past this depth are unknown, so a long chain ends. */
const MAX_CALL_DEPTH = 8;
let callDepth = 0;

/**
 * What calling `fn` with `args` (evaluated in `caller`) returns, run in
 * `callee` (the scope of the module that declares `fn`): each parameter
 * bound to its argument, then the body read statement by statement.
 * Only `const` declarations, `return`, and `if` around a lone `return`
 * are followed; anything else is unknown. An `if` whose test can go
 * either way adds its `return` and carries on.
 */
function callValue(
  fn: FunctionNode,
  args: readonly Node[],
  caller: Scope,
  callee: Scope,
): Value {
  if (args.some((arg) => arg.type === "SpreadElement")) return UNKNOWN;
  const key = `call:${callee.model.key}:${fn.start}`;
  if (callee.pending.has(key) || callDepth >= MAX_CALL_DEPTH) return UNKNOWN;
  const values = args.map((arg) => evaluate(arg as Expression, caller));
  // The same call with the same values returns the same.
  const memoKey = `${key}(${values.map(valueKey).join(",")})`;
  const memoized = caller.memo.get(memoKey);
  if (memoized !== undefined) return memoized;
  const result = runCall(fn, values, callee, key);
  caller.memo.set(memoKey, result);
  return result;
}

function runCall(
  fn: FunctionNode,
  values: Value[],
  callee: Scope,
  key: string,
): Value {
  const outer = callee.locals;
  const locals = new Map(outer);
  callee.locals = locals;
  callee.pending.add(key);
  callDepth++;
  try {
    for (const [index, param] of fn.params.entries()) {
      if (
        !bindParameter(
          param as Node,
          values[index] ?? UNDEFINED,
          locals,
          callee,
        )
      ) {
        return UNKNOWN;
      }
    }
    if (fn.body.type !== "BlockStatement") {
      return evaluate(fn.body as Expression, callee);
    }
    let result: Value = possible();
    for (const statement of fn.body.body as Node[]) {
      switch (statement.type) {
        case "ReturnStatement":
          return join(result, returned(statement, callee));
        case "VariableDeclaration": {
          if (statement.kind !== "const") return UNKNOWN;
          for (const declarator of statement.declarations) {
            if (
              !declarator.init ||
              !bindParameter(
                declarator.id as Node,
                evaluate(declarator.init, callee),
                locals,
                callee,
              )
            ) {
              return UNKNOWN;
            }
          }
          break;
        }
        case "IfStatement": {
          const consequent = loneReturn(statement.consequent as Node);
          const alternate = statement.alternate
            ? loneReturn(statement.alternate as Node)
            : null;
          if (!consequent || alternate === undefined) return UNKNOWN;
          const truth = truthOf(evaluate(statement.test, callee));
          if (truth !== "falsy") {
            result = join(result, returned(consequent, callee));
            if (truth === "truthy") return result;
          }
          // A `truthy` test already returned.
          if (alternate) return join(result, returned(alternate, callee));
          break;
        }
        default:
          return UNKNOWN;
      }
    }
    return join(result, UNDEFINED);
  } finally {
    callDepth--;
    callee.pending.delete(key);
    callee.locals = outer;
  }
}

/** The `return` `node` is, or a block holds alone; `undefined` otherwise. */
function loneReturn(
  node: Node,
): Extract<Node, { type: "ReturnStatement" }> | undefined {
  if (node.type === "ReturnStatement") return node;
  if (node.type === "BlockStatement" && node.body.length === 1) {
    const [only] = node.body as Node[];
    if (only.type === "ReturnStatement") return only;
  }
  return undefined;
}

function returned(
  statement: Extract<Node, { type: "ReturnStatement" }>,
  scope: Scope,
): Value {
  return statement.argument
    ? evaluate(statement.argument as Expression, scope)
    : UNDEFINED;
}

/**
 * Binds the names `pattern` declares in `locals` to their part of
 * `value`: an identifier, a default (`a = 1`), or an object pattern of
 * named properties. `false` for any other pattern.
 */
function bindParameter(
  pattern: Node,
  value: Value,
  locals: Map<Binding, Value>,
  scope: Scope,
): boolean {
  switch (pattern.type) {
    case "Identifier": {
      const binding = scope.model.scopes.bindingOf(pattern);
      if (!binding) return false;
      // The body may change an object it's handed (`o.push(1)`) before
      // reading it again: some object, contents unknown.
      locals.set(binding, withoutContents(value));
      return true;
    }
    case "AssignmentPattern": {
      // The default applies when the value is `undefined`.
      let bound = value;
      if (value !== UNKNOWN && value.has(undefined)) {
        const defined = new Set(value);
        defined.delete(undefined);
        bound = join(defined, evaluate(pattern.right, scope));
      }
      return bindParameter(pattern.left as Node, bound, locals, scope);
    }
    case "ObjectPattern":
      for (const property of pattern.properties as Node[]) {
        if (
          property.type !== "Property" ||
          property.computed ||
          property.key.type !== "Identifier"
        ) {
          return false;
        }
        const name = property.key.name;
        // Destructuring `null` or `undefined` throws: no value to bind.
        const part = flatMap(value, (p) =>
          isNullish(p) ? possible() : readProperty(p, name),
        );
        if (!bindParameter(property.value as Node, part, locals, scope)) {
          return false;
        }
      }
      return true;
    default:
      return false;
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
      const key = memberKey(node);
      const props =
        key === undefined ? undefined : passedProps(scope, object.name);
      if (key === undefined || !props) return UNKNOWN;
      const prop = props.get(key);
      if (!prop) return UNDEFINED;
      return prop.maybeAbsent ? join(prop.value, UNDEFINED) : prop.value;
    }
  }
  if (object.type === "Super") return UNKNOWN;
  const target = evaluate(object, scope);
  // `undefined?.x` is `undefined`.
  if (optional && isOnlyUndefined(target)) return UNDEFINED;
  const keys = computed
    ? propertyKeys(evaluate(property as Expression, scope))
    : property.type === "Identifier"
      ? [property.name]
      : undefined;
  if (keys === undefined) return UNKNOWN;
  // A known object's own properties and elements, a string's `length`;
  // anything else (`null.x` throws, a getter may run) is beyond this model.
  return flatMap(target, (p) => {
    if (optional && isNullish(p)) return UNDEFINED;
    let value: Value = possible();
    for (const key of keys) value = join(value, readProperty(p, key));
    return value;
  });
}

/**
 * The property names `value`'s keys read, each converted as JavaScript
 * does (`obj[undefined]` reads `"undefined"`); `undefined` unless there
 * are some and every one is a primitive.
 */
function propertyKeys(value: Value): string[] | undefined {
  if (value === UNKNOWN) return undefined;
  const keys: string[] = [];
  for (const p of value) {
    if (isObject(p)) return undefined;
    keys.push(String(p));
  }
  return keys.length > 0 ? keys : undefined;
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
    const key = propertyName(property);
    if (key === undefined || key === "__proto__") return possible(OBJECT);
    props.set(key, evaluate(property.value as Expression, scope));
  }
  return possible(shape({ kind: "object", props }));
}
