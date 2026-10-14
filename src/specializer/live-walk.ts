import type { Scopes } from "sveast/scope";
import { type AST, children, type Expression, locate } from "sveast/walk";
import type { Node } from "./ast";
import { UnsupportedComponentError } from "./component-model";
import {
  bindEach,
  evaluate,
  type PassedProp,
  type Scope,
  spreadProps,
  whyUnknownLater,
} from "./evaluate";
import { memberOf } from "./exports";
import type { ClassTokens, LibraryPaths } from "./library";
import type { CallSite } from "./usage";
import {
  isEmptyArray,
  isNeverNullish,
  join,
  OBJECT,
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
  /** Classes it can apply (see `ClassTokens`). */
  classes: Set<string>;
  /** Prefixes of classes built from values it can't bound. */
  prefixes: Set<string>;
  /** Library components it can render, with the props it passes them. */
  childSites: CallSite[];
};

/** A walk in progress: what it found, and the library it reads. */
type Walk = LiveResult & {
  tokens: ClassTokens | undefined;
  library: LibraryPaths;
};

function addTokens(text: string, result: Walk): void {
  const { tokens } = result;
  if (!tokens || !text.includes(tokens.marker)) return;
  for (const token of tokens.text(text)) {
    if (token.endsWith("-")) result.prefixes.add(token);
    else result.classes.add(token);
  }
}

function addStrings(value: Value, result: Walk): void {
  if (value === UNKNOWN) return;
  for (const p of value) if (typeof p === "string") addTokens(p, result);
}

/**
 * Walks `scope.model`'s script and markup, skipping whatever its usage
 * proves can't run: the falsy side of `&&`, `||`, `??`, ternaries, `if`
 * statements, `{#if}` branches, `{#each}` over an array that stays empty,
 * and falsy `class:` directives. Everything else is assumed live,
 * including every function body.
 */
export function walkLive(scope: Scope, library: LibraryPaths): LiveResult {
  const result: Walk = {
    classes: new Set(),
    prefixes: new Set(),
    childSites: [],
    tokens: library.spec.classTokens,
    library,
  };
  const { ast } = scope.model;
  // Scripts first, then markup; `<style>` holds no rendered classes.
  for (const node of [ast.module, ast.instance, ast.fragment]) {
    if (node) visit(node, scope, result);
  }
  return result;
}

function visitAll(nodes: Iterable<Node>, scope: Scope, result: Walk) {
  for (const node of nodes) visit(node, scope, result);
}

function visitBranches(
  truth: Truth,
  consequent: Node | null | undefined,
  alternate: Node | null | undefined,
  scope: Scope,
  result: Walk,
): void {
  if (truth !== "falsy" && consequent) visit(consequent, scope, result);
  if (truth !== "truthy" && alternate) visit(alternate, scope, result);
}

function visit(node: Node, scope: Scope, result: Walk): void {
  switch (node.type) {
    // Import bindings aren't uses.
    case "ImportDeclaration":
      return;

    case "Literal":
      if (typeof node.value === "string") addTokens(node.value, result);
      return;

    case "TemplateLiteral": {
      const marker = result.tokens?.marker;
      if (
        marker !== undefined &&
        node.quasis.some((quasi) => quasi.value.raw.includes(marker))
      ) {
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
    // `x--btn--` in `x--btn--${kind}` becomes a prefix.
    case "TemplateElement":
      addTokens(node.value.raw, result);
      return;

    case "Text":
      // Attribute text (`class="x--a"`, `labelClass="x--b"`); element
      // text never names a class, and skipping it here costs nothing.
      addTokens(node.data, result);
      return;

    case "Identifier": {
      // A component referenced as a value (`this={Comp}`, `const C = …`)
      // can render with any props.
      const key = scope.model.componentImports.get(node.name);
      if (key) result.childSites.push(openSite(key));
      // An object of components used other than as `L.Member`: any of them.
      if (scope.model.memberImports.has(node.name)) {
        throw new UnsupportedComponentError(
          `${scope.model.key} uses \`${node.name}\`, an object of components, as a value`,
        );
      }
      return;
    }

    case "MemberExpression": {
      const { object, property } = node;
      if (object.type !== "Identifier") break;
      const members = scope.model.memberImports.get(object.name);
      if (!members || node.computed || property.type !== "Identifier") break;
      const member = memberOf(members, [property.name]);
      if (member.kind === "component") {
        result.childSites.push(openSite(member.key));
      } else if (member.kind !== "value") {
        throw new UnsupportedComponentError(
          `${scope.model.key} uses \`${object.name}.${property.name}\`, which couldn't be resolved, as a value`,
        );
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
      // The body sees the item's value: an element of a known array.
      const unbind = bindEach(node, scope);
      try {
        if (node.key) visit(node.key, scope, result);
        visit(node.body, scope, result);
      } finally {
        unbind();
      }
      if (node.fallback) visit(node.fallback, scope, result);
      return;
    }

    case "ClassDirective": {
      visit(node.expression, scope, result);
      const truth = truthOf(evaluate(node.expression, scope));
      if (truth !== "falsy") addTokens(node.name, result);
      return;
    }

    case "Component": {
      const key = componentKey(node.name, scope, result.library);
      if (key) {
        result.childSites.push(
          locateReason(
            callSiteFromElement(
              node,
              key,
              (expression) => evaluate(expression, scope),
              (argument) => spreadProps(argument, scope),
              explainAt(node, scope),
              (expression) => instanceMembers(expression, scope.model.scopes),
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
          (expression) => instanceMembers(expression, scope.model.scopes),
        ),
      );
      break;
  }

  visitAll(children(node), scope, result);
}

function openSite(component: string): CallSite {
  return { component, open: true, props: new Map(), slots: null };
}

/**
 * The library module `<name>` renders (`<Button>`, `<L.Button>`), or
 * `undefined` for a tag that renders none: one the component declares (a
 * snippet parameter, `{@const}`), or another package's component, whose
 * content is walked as live. A package's component that imports the
 * library is in the app's `content` (the build plugins check), so its own
 * call sites are read there. Throws for a tag bound to a module of the
 * library the walk can't trace: whatever it renders is invisible to it.
 */
function componentKey(
  name: string,
  scope: Scope,
  library: LibraryPaths,
): string | undefined {
  const { model } = scope;
  const [root, ...path] = name.split(".");
  const members = model.memberImports.get(root);
  if (members) {
    const rendered = memberOf(members, path);
    if (rendered.kind === "component") return rendered.key;
    if (rendered.kind === "value") return undefined;
  } else {
    const key =
      path.length === 0 ? model.componentImports.get(name) : undefined;
    if (key) return key;
    if (!model.otherImports.has(root)) return undefined;
  }
  const source = model.packageImports.get(root);
  if (source !== undefined && !library.isSpecifier(source)) return undefined;
  throw new UnsupportedComponentError(
    `${model.key} renders <${name}>, which couldn't be resolved`,
  );
}

/** `Button.svelte:12`: where `node` is in the component `scope` walks. */
function whereIn(node: { start: number }, scope: Scope): string {
  return `${scope.model.key.split("/").pop()}:${locate(scope.model.code, node.start).line}`;
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

/**
 * Why an expression is unknown, for the report: called during the walk,
 * the reason is worked out only when asked.
 */
export type Explain = (expression: Expression) => () => string | undefined;

/** Explains unknown values at `node`, prefixed with where it is. */
function explainAt(node: { start: number }, scope: Scope): Explain {
  return (expression) => {
    const why = whyUnknownLater(expression, scope);
    return () => {
      const reason = why();
      return reason && `${whereIn(node, scope)} ${reason}`;
    };
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

/**
 * What an element's content passes: the slots it fills (`null` if that
 * can't be told), the snippets it passes as props, and whether anything
 * else is left for the default slot, Svelte 5's `children`.
 */
function readContent(fragment: AST.Fragment): {
  slots: Set<string> | null;
  snippets: string[];
  children: boolean;
} {
  let slots: Set<string> | null = new Set();
  const snippets: string[] = [];
  let children = false;
  for (const child of fragment.nodes) {
    if (child.type === "Comment") continue;
    if (child.type === "Text" && WHITESPACE_ONLY.test(child.data)) continue;
    // A snippet is a prop by its name, and fills that slot
    // (`children` the default one).
    if (child.type === "SnippetBlock") {
      const { name } = child.expression;
      snippets.push(name);
      slots?.add(name === "children" ? "default" : name);
      continue;
    }
    const slot =
      "attributes" in child
        ? child.attributes.find(
            (attribute) =>
              attribute.type === "Attribute" && attribute.name === "slot",
          )
        : undefined;
    if (!slot) {
      children = true;
      slots?.add("default");
      continue;
    }
    const text =
      slot.type === "Attribute" && Array.isArray(slot.value)
        ? slot.value
        : null;
    if (text?.length === 1 && text[0].type === "Text") slots?.add(text[0].data);
    else slots = null;
  }
  return { slots, snippets, children };
}

function whyOf(site: CallSite): NonNullable<CallSite["why"]> {
  site.why ??= new Map();
  return site.why;
}

/** Why an attribute's value is unknown: its first unknown expression. */
function attributeWhy(
  attribute: AST.Attribute,
  explain: Explain,
): () => string | undefined {
  const { value } = attribute;
  const parts = value === true ? [] : Array.isArray(value) ? value : [value];
  const whys = parts.flatMap((part) =>
    part.type === "Text" ? [] : [explain(part.expression)],
  );
  return () => {
    for (const why of whys) {
      const reason = why();
      if (reason) return reason;
    }
    return undefined;
  };
}

/** Members of an instance that set no props: Svelte 3/4's `$destroy` and `$on`. */
const INSTANCE_METHODS = new Set(["$destroy", "$on"]);

/**
 * The members code reads off the instance `bind:this={expression}` binds,
 * in the component `scopes` analyzes (`dialog.open` in `dialog.open()`);
 * `null` when the instance may be used any other way: handed on, its
 * members written, or a member like `$set` called. Testing it (`if
 * (dialog)`, `dialog && …`), reassigning it and comparing it are fine.
 */
export function instanceMembers(
  expression: Expression,
  scopes: Scopes,
): Set<string> | null {
  if (expression.type !== "Identifier") return null;
  const binding = scopes.bindingOf(expression);
  if (!binding) return null;
  const members = new Set<string>();
  for (const { node, parent, mutates } of binding.references) {
    if (mutates) return null;
    switch (parent.type) {
      case "BindDirective":
        if (parent.name === "this" && parent.expression === node) continue;
        return null;
      case "MemberExpression": {
        const { property } = parent;
        if (
          parent.object !== node ||
          parent.computed ||
          property.type !== "Identifier" ||
          (property.name.startsWith("$") &&
            !INSTANCE_METHODS.has(property.name))
        ) {
          return null;
        }
        members.add(property.name);
        continue;
      }
      case "AssignmentExpression":
        if (parent.left === node && parent.operator === "=") continue;
        return null;
      case "LogicalExpression":
        // Only a falsy `dialog` gets past `&&`.
        if (parent.left === node && parent.operator === "&&") continue;
        return null;
      case "IfStatement":
      case "IfBlock":
      case "ConditionalExpression":
        if (parent.test === node) continue;
        return null;
      case "UnaryExpression":
      case "BinaryExpression":
        continue;
      default:
        return null;
    }
  }
  return members;
}

/**
 * A call site for `<Component …>`, its props evaluated by
 * `evaluateExpression`. `spread` gives the props a spread passes when it
 * can tell (the component's own `$$restProps`); any other spread makes
 * the site open. `instance` reads what `bind:this` binds (see
 * `instanceMembers`); without it, the instance may be used any way.
 */
export function callSiteFromElement(
  node: AST.Component | AST.SvelteSelf,
  component: string,
  evaluateExpression: (expression: Expression) => Value,
  spread?: (argument: Expression) => Map<string, PassedProp> | undefined,
  explain?: Explain,
  instance?: (expression: Expression) => Set<string> | null,
): CallSite {
  const { slots, snippets, children } = readContent(node.fragment);
  const site: CallSite = {
    component,
    open: false,
    props: new Map(),
    slots,
    ...(children && { children }),
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
          if (value === UNKNOWN && explain) {
            whyOf(site).set(attribute.name, attributeWhy(attribute, explain));
          }
        }
        break;
      case "BindDirective": {
        if (attribute.name === "this") {
          site.instance =
            instance?.(attribute.expression as Expression) ?? null;
          break;
        }
        site.props.set(attribute.name, UNKNOWN);
        const why = explain?.(attribute.expression as Expression);
        whyOf(site).set(
          attribute.name,
          () => why?.() ?? "is bound with `bind:`",
        );
        break;
      }
    }
  }
  for (const name of snippets) site.props.set(name, possible(OBJECT));
  return site;
}
