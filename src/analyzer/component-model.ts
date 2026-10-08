import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { lexImportsExports } from "sveast/lexer";
import { type AST, type Expression, isReference, walk } from "sveast/walk";
import { parse } from "../indexer/parser";
import { forEachNode, lineAt, type Node, patternNames, rootName } from "./ast";

/** Marks the names `pattern` binds as unknown, with why. */
function markUnknown(
  model: ComponentModel,
  pattern: Node | null | undefined,
  reason: string,
): void {
  const names = new Set<string>();
  patternNames(pattern, names);
  for (const name of names) markNameUnknown(model, name, reason);
}

function markNameUnknown(
  model: ComponentModel,
  name: string,
  reason: string,
): void {
  model.unknownNames.add(name);
  if (!model.unknownReasons.has(name)) model.unknownReasons.set(name, reason);
}

/** A top-level `function` declaration: some object, never re-bound. */
export const FUNCTION_DECLARATION = "function";

/**
 * What the usage analysis needs to know about one Carbon component, read
 * once from its source.
 */
export type ComponentModel = {
  /** Path relative to Carbon's `src`, e.g. `Button/Button.svelte`. */
  key: string;
  /** The source `ast` was parsed from. */
  code: string;
  ast: AST.Root;
  /** `export let` props and their default expressions. */
  props: Map<string, Expression | null>;
  /**
   * Each prop's local name -> the name a parent passes it by: the same for
   * `export let kind`, `class` for `let className; export { className as class }`.
   */
  propNames: Map<string, string>;
  /** Top-level `let`/`const`, functions, and `$: x = …` declarations. */
  declarations: Map<string, Expression | null | typeof FUNCTION_DECLARATION>;
  /** The `$: x = …` assignments that define a declaration above. */
  reactiveDeclarations: WeakSet<Node>;
  /**
   * Names the analysis treats as unknown: assigned outside their
   * declaration (handlers, `bind:`, `$: if …`), or re-bound by a nested
   * scope (a parameter, `{#each}` context, `let:`) the walk can't tell apart.
   */
  unknownNames: Set<string>;
  /** Why each of `unknownNames` is unknown, for the report. */
  unknownReasons: Map<string, string>;
  /** Local binding -> Carbon module key, for relative `.svelte` imports. */
  componentImports: Map<string, string>;
  /** Every other imported binding. */
  otherImports: Set<string>;
  /** Keys this component passes to `setContext` as string literals. */
  providedContexts: Set<string>;
  /**
   * How each name's value can reach code that might mutate it, which
   * decides whether an object or array literal it holds stays known (see
   * `Shape`). `$$props.x` adds `"$$props.x"` (the prop passed as `x`) and
   * any other use of `$$props` adds `"*"`, both `full`: they reach the
   * props themselves.
   */
  escapes: Map<string, Escape>;
  /**
   * `rest` in `let { a, ...rest } = $props()`, when nothing reassigns or
   * shadows it: it holds the props the component doesn't declare, like
   * `$$restProps`.
   */
  restPropsName?: string;
};

/**
 * How a name's value leaves the component's sight. `full`: the value
 * itself does (it's mutated, aliased, passed on, or a method is called on
 * it). `paths`: the property paths read from it (`["kind"]` for
 * `button.kind`, `["[]", "text"]` for `item.text` in `{#each name as
 * item}`). What a path reads may go anywhere, which only matters when
 * it's an object.
 */
export type Escape = { full: boolean; paths: string[][] };

/** Thrown for a component the analysis can't model. */
export class UnsupportedComponentError extends Error {}

/** Runes whose argument is the value they declare. */
const VALUE_RUNES = new Set(["$state", "$state.raw", "$derived"]);

/** `$state`, `$state.raw`, … for a rune callee; `undefined` otherwise. */
function runeName(callee: Node): string | undefined {
  if (callee.type === "Identifier") {
    return callee.name.startsWith("$") ? callee.name : undefined;
  }
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name.startsWith("$") &&
    callee.property.type === "Identifier"
  ) {
    return `${callee.object.name}.${callee.property.name}`;
  }
  return undefined;
}

/** The rune `init` calls, if it's a call to one. */
function runeCall(
  init: Expression | null,
): { rune: string; argument: Expression | null } | undefined {
  if (init?.type !== "CallExpression") return undefined;
  const rune = runeName(init.callee as Node);
  if (!rune) return undefined;
  const [first] = init.arguments;
  return {
    rune,
    argument: first && first.type !== "SpreadElement" ? first : null,
  };
}

const cache = new Map<string, { mtimeMs: number; model: ComponentModel }>();

/**
 * Reads and models `key` under `carbonSrc`. Cached by absolute path and
 * modification time, so a linked Carbon checkout edited between
 * `vite build --watch` rebuilds is read again.
 */
export function loadComponentModel(
  carbonSrc: string,
  key: string,
): ComponentModel {
  const file = path.join(carbonSrc, key);
  const { mtimeMs } = statSync(file);
  const cached = cache.get(file);
  if (cached?.mtimeMs === mtimeMs) return cached.model;
  const model = buildComponentModel(
    readFileSync(file, "utf8"),
    key,
    (from, source, name) => resolveReExport(carbonSrc, from, source, name),
  );
  cache.set(file, { mtimeMs, model });
  return model;
}

/**
 * The Carbon component that `import { name } from source` binds in module
 * `from`, following `.js` barrels like `ListBox/index.js`.
 */
type ImportResolver = (
  from: string,
  source: string,
  name: string,
) => string | undefined;

const MAX_BARREL_HOPS = 4;

function resolveReExport(
  carbonSrc: string,
  from: string,
  source: string,
  name: string,
  hops = 0,
): string | undefined {
  if (hops > MAX_BARREL_HOPS) return undefined;
  const joined = path.posix.join(path.posix.dirname(from), source);
  if (joined.endsWith(".svelte"))
    return name === "default" ? joined : undefined;
  const barrel = [joined, `${joined}.js`, `${joined}/index.js`].find(
    (candidate) =>
      candidate.endsWith(".js") && existsSync(path.join(carbonSrc, candidate)),
  );
  if (!barrel) return undefined;
  const code = readFileSync(path.join(carbonSrc, barrel), "utf8");
  for (const statement of lexImportsExports(code)) {
    if (statement.kind !== "export" || !statement.source) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.exported === name || specifier.kind === "all") {
        const resolved = resolveReExport(
          carbonSrc,
          barrel,
          statement.source.value,
          specifier.kind === "all" ? name : specifier.local,
          hops + 1,
        );
        if (resolved) return resolved;
      }
    }
  }
  return undefined;
}

export function buildComponentModel(
  code: string,
  key: string,
  resolveImport: ImportResolver = () => undefined,
  /** `code` already parsed, to skip parsing it again. */
  parsed?: AST.Root,
): ComponentModel {
  const ast = parsed ?? parse(code, { comments: false });
  const model: ComponentModel = {
    key,
    code,
    ast,
    props: new Map(),
    propNames: new Map(),
    declarations: new Map(),
    reactiveDeclarations: new WeakSet(),
    unknownNames: new Set(),
    unknownReasons: new Map(),
    componentImports: new Map(),
    otherImports: new Set(),
    providedContexts: new Set(),
    escapes: findEscapes(ast),
  };

  /** Instance-script `let` names: a later `export { … }` can make them props. */
  const letDeclarations = new Set<string>();
  for (const script of [ast.module, ast.instance]) {
    if (!script) continue;
    const isInstance = script === ast.instance;
    for (const statement of script.content.body) {
      readTopLevelStatement(
        model,
        statement as Node,
        isInstance,
        resolveImport,
        isInstance ? letDeclarations : new Set(),
      );
    }
  }

  // `let a; export { a as b }` declares prop `b`.
  for (const statement of ast.instance?.content.body ?? []) {
    if (statement.type !== "ExportNamedDeclaration" || statement.declaration) {
      continue;
    }
    if (statement.source) continue;
    for (const specifier of statement.specifiers) {
      if (
        specifier.local.type !== "Identifier" ||
        !letDeclarations.has(specifier.local.name)
      ) {
        continue;
      }
      const local = specifier.local.name;
      const exported =
        specifier.exported.type === "Identifier"
          ? specifier.exported.name
          : String(specifier.exported.value);
      const init = model.declarations.get(local);
      model.declarations.delete(local);
      model.props.set(
        local,
        init === FUNCTION_DECLARATION ? null : (init ?? null),
      );
      model.propNames.set(local, exported);
    }
  }

  const topLevel = new Set([
    ...model.props.keys(),
    ...model.declarations.keys(),
  ]);
  const nested = nestedBindings(ast);
  for (const name of nested) {
    if (topLevel.has(name)) {
      markNameUnknown(model, name, "is shadowed by a nested binding");
    }
  }

  /** Names written after their declaration: a rest name among them is unusable. */
  const written = new Set<string>();
  forEachNode(ast, (node) => {
    switch (node.type) {
      case "AssignmentExpression":
        if (!model.reactiveDeclarations.has(node)) {
          markUnknown(
            model,
            node.left as Node,
            `is assigned at line ${lineAt(code, node.start)}`,
          );
          patternNames(node.left, written);
        }
        break;
      case "UpdateExpression":
        markUnknown(
          model,
          node.argument as Node,
          `is updated at line ${lineAt(code, node.start)}`,
        );
        patternNames(node.argument, written);
        break;
      case "BindDirective":
        markNameUnknown(
          model,
          rootName(node.expression),
          `is bound with \`bind:\` at line ${lineAt(code, node.start)}`,
        );
        written.add(rootName(node.expression));
        break;
      case "CallExpression":
        if (node.callee.type === "Identifier") {
          const [first] = node.arguments;
          if (
            node.callee.name === "setContext" &&
            first?.type === "Literal" &&
            typeof first.value === "string"
          ) {
            model.providedContexts.add(first.value);
          }
        }
        break;
    }
  });

  if (
    model.restPropsName &&
    (written.has(model.restPropsName) || nested.has(model.restPropsName))
  ) {
    model.restPropsName = undefined;
  }

  return model;
}

function readTopLevelStatement(
  model: ComponentModel,
  statement: Node,
  isInstance: boolean,
  resolveImport: ImportResolver,
  /** Collects top-level `let` names. */
  lets: Set<string>,
): void {
  if (statement.type === "ImportDeclaration") {
    const source = String(statement.source.value);
    for (const specifier of statement.specifiers) {
      const imported =
        specifier.type === "ImportDefaultSpecifier"
          ? "default"
          : specifier.type === "ImportSpecifier" &&
              specifier.imported.type === "Identifier"
            ? specifier.imported.name
            : undefined;
      const key =
        source.startsWith(".") && imported
          ? resolveImport(model.key, source, imported)
          : undefined;
      if (key) model.componentImports.set(specifier.local.name, key);
      else model.otherImports.add(specifier.local.name);
    }
    return;
  }

  const isExport = statement.type === "ExportNamedDeclaration";
  const declaration = isExport ? statement.declaration : statement;
  if (!declaration) return;

  if (declaration.type === "VariableDeclaration") {
    for (const declarator of declaration.declarations) {
      const rune = runeCall(declarator.init ?? null);
      if (rune?.rune === "$props" && isInstance) {
        readPropsRune(model, declarator.id as Node);
        continue;
      }
      if (declarator.id.type !== "Identifier") {
        markUnknown(
          model,
          declarator.id as Node,
          "is declared by destructuring",
        );
        continue;
      }
      // `$state(x)`, `$state.raw(x)` and `$derived(x)` hold `x`; any
      // other rune (`$derived.by`, `$props.id`) evaluates as unknown.
      const init =
        rune && VALUE_RUNES.has(rune.rune)
          ? rune.argument
          : (declarator.init ?? null);
      if (isExport && isInstance && declaration.kind !== "const") {
        model.props.set(declarator.id.name, init);
        model.propNames.set(declarator.id.name, declarator.id.name);
      } else {
        model.declarations.set(declarator.id.name, init);
        if (declaration.kind === "let") lets.add(declarator.id.name);
      }
    }
    return;
  }

  if (declaration.type === "FunctionDeclaration" && declaration.id) {
    model.declarations.set(declaration.id.name, FUNCTION_DECLARATION);
    return;
  }

  if (
    statement.type === "LabeledStatement" &&
    statement.label.name === "$" &&
    statement.body.type === "ExpressionStatement" &&
    statement.body.expression.type === "AssignmentExpression" &&
    statement.body.expression.operator === "=" &&
    statement.body.expression.left.type === "Identifier"
  ) {
    const assignment = statement.body.expression;
    const name =
      assignment.left.type === "Identifier" ? assignment.left.name : "";
    // `$: $store = …` writes a store; a second definition, or one that
    // redefines a prop or variable, is just another assignment. Either way
    // the name becomes unknown.
    if (
      (name.startsWith("$") && !name.startsWith("$$")) ||
      model.declarations.has(name) ||
      model.props.has(name)
    ) {
      return;
    }
    model.declarations.set(name, assignment.right);
    model.reactiveDeclarations.add(assignment);
  }
}

/**
 * Whether `parent` only tests or renders `child`, never hands it on: a
 * condition, a comparison, `{text}`, or an element's attribute (a
 * component's props are handed on).
 */
function onlyTests(
  parent: Node | undefined,
  child: Node,
  ancestors: readonly Node[],
): boolean {
  switch (parent?.type) {
    case "ExpressionTag": {
      const owner = ancestors.at(-1);
      const element = ancestors.at(-2);
      return !(
        owner?.type === "Attribute" &&
        (element?.type === "Component" ||
          element?.type === "SvelteComponent" ||
          element?.type === "SvelteSelf")
      );
    }
    case "IfStatement":
    case "IfBlock":
    case "ConditionalExpression":
      return parent.test === child;
    case "UnaryExpression":
      return parent.operator === "!" || parent.operator === "typeof";
    case "BinaryExpression":
      return ["===", "!==", "==", "!="].includes(parent.operator);
    case "ClassDirective":
      return true;
    default:
      return false;
  }
}

/** Whether `parent` writes to `child`, deletes it, or calls it as a method. */
function mutates(parent: Node | undefined, child: Node): boolean {
  switch (parent?.type) {
    case "AssignmentExpression":
      return parent.left === child;
    case "UpdateExpression":
      return true;
    case "UnaryExpression":
      return parent.operator === "delete";
    case "CallExpression":
    case "NewExpression":
      return parent.callee === child;
    case "BindDirective":
      return true;
    default:
      return false;
  }
}

/** See `ComponentModel.escapes`. */
function findEscapes(ast: AST.Root): Map<string, Escape> {
  const escapes = new Map<string, Escape>();
  const entry = (name: string): Escape => {
    let found = escapes.get(name);
    if (!found) {
      found = { full: false, paths: [] };
      escapes.set(name, found);
    }
    return found;
  };
  /** `[array, item]` for each `{#each array as item}`. */
  const eachItems: Array<[string, string]> = [];
  const stack: Node[] = [];
  walk(ast, {
    enter(node, parent, key) {
      stack.push(node as Node);
      if (
        node.type === "EachBlock" &&
        node.expression.type === "Identifier" &&
        node.context?.type === "Identifier"
      ) {
        eachItems.push([node.expression.name, node.context.name]);
      }
      if (node.type !== "Identifier" || !isReference(node, parent)) return;
      if (node.name === "$$props") {
        const member = memberKey(parent as Node | null);
        entry(member === undefined ? "*" : `$$props.${member}`).full = true;
        return;
      }
      if (
        // Declaring or exporting a name doesn't hand its value anywhere,
        // and `{#each name}` hands on its items (see `eachItems`).
        (parent?.type === "VariableDeclarator" && key === "id") ||
        parent?.type === "ExportSpecifier" ||
        (parent?.type === "EachBlock" &&
          (key === "expression" || key === "context"))
      ) {
        return;
      }
      // Follow the member chain the name starts: `name.a.b`.
      const path: string[] = [];
      let current = node as Node;
      let index = stack.length - 1;
      for (;;) {
        const up = stack[index - 1];
        if (up?.type !== "MemberExpression" || up.object !== current) break;
        path.push(memberKey(up) ?? "*");
        current = up;
        index--;
      }
      const consumer = stack[index - 1];
      if (mutates(consumer, current)) {
        entry(node.name).full = true;
      } else if (path.length > 0) {
        entry(node.name).paths.push(path);
      } else if (
        !onlyTests(consumer, current, stack.slice(0, Math.max(0, index - 1)))
      ) {
        entry(node.name).full = true;
      }
    },
    leave() {
      stack.pop();
    },
  });
  // What happens to an item happens to its array's elements: an item
  // handed on is a path that matters only if items are objects.
  for (const [array, item] of eachItems.reverse()) {
    const itemEscape = escapes.get(item);
    if (!itemEscape) continue;
    const target = entry(array);
    if (itemEscape.full) target.paths.push(["[]"]);
    for (const path of itemEscape.paths) target.paths.push(["[]", ...path]);
  }
  return escapes;
}

/** `x` in `<object>.x` or `<object>["x"]`, if `parent` is such a member. */
function memberKey(parent: Node | null): string | undefined {
  if (parent?.type !== "MemberExpression") return undefined;
  const { property, computed } = parent;
  if (!computed && property.type === "Identifier") return property.name;
  return computed &&
    property.type === "Literal" &&
    typeof property.value === "string"
    ? property.value
    : undefined;
}

/**
 * `let { kind = "primary", class: className, ...rest } = $props()`: each
 * property is a prop, its default unwrapped from `$bindable(…)`. A rest
 * element, a nested pattern or `let props = $props()` reads props the
 * analysis doesn't model, so those names are unknown.
 */
function readPropsRune(model: ComponentModel, pattern: Node): void {
  if (pattern.type !== "ObjectPattern") {
    markUnknown(model, pattern, "holds every prop (`$props()`)");
    return;
  }
  for (const property of pattern.properties) {
    if (property.type === "RestElement") {
      markUnknown(
        model,
        property.argument as Node,
        "is the rest of `$props()`",
      );
      if (property.argument.type === "Identifier") {
        model.restPropsName = property.argument.name;
      }
      continue;
    }
    if (property.computed) {
      markUnknown(
        model,
        property.value as Node,
        "has a computed `$props()` key",
      );
      continue;
    }
    const passedAs =
      property.key.type === "Identifier"
        ? property.key.name
        : property.key.type === "Literal"
          ? String(property.key.value)
          : undefined;
    const value = property.value as Node;
    const [local, fallback] =
      value.type === "AssignmentPattern"
        ? [value.left as Node, value.right as Expression]
        : [value, null];
    if (passedAs === undefined || local.type !== "Identifier") {
      markUnknown(model, value, "is a nested `$props()` pattern");
      continue;
    }
    const bindable = runeCall(fallback);
    model.props.set(
      local.name,
      bindable?.rune === "$bindable" ? bindable.argument : fallback,
    );
    model.propNames.set(local.name, passedAs);
  }
}

/** Names bound anywhere but the top level of a `<script>`. */
function nestedBindings(ast: AST.Root): Set<string> {
  const names = new Set<string>();
  const declaredInside = (node: Node) =>
    forEachNode(node, (inner) => {
      if (inner.type === "VariableDeclarator") patternNames(inner.id, names);
      if (inner.type === "FunctionDeclaration" && inner.id) {
        names.add(inner.id.name);
      }
    });

  forEachNode(ast, (node) => {
    switch (node.type) {
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        for (const param of node.params) patternNames(param, names);
        declaredInside(node.body);
        break;
      case "BlockStatement":
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
      case "SwitchStatement":
        declaredInside(node);
        break;
      case "CatchClause":
        patternNames(node.param, names);
        break;
      case "EachBlock":
        patternNames(node.context, names);
        if (node.index) names.add(node.index);
        break;
      case "AwaitBlock":
        patternNames(node.value, names);
        patternNames(node.error, names);
        break;
      case "SnippetBlock":
        for (const param of node.parameters) patternNames(param, names);
        break;
      case "LetDirective":
        names.add(node.name);
        if (node.expression) patternNames(node.expression as Node, names);
        break;
      case "ConstTag":
        for (const declarator of node.declaration.declarations) {
          patternNames(declarator.id, names);
        }
        break;
    }
  });
  return names;
}
