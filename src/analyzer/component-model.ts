import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { lexImportsExports } from "sveast/lexer";
import type { AST, Expression } from "sveast/walk";
import { parse } from "../indexer/parser";
import { forEachNode, type Node, patternNames, rootName } from "./ast";

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
  /** Local binding -> Carbon module key, for relative `.svelte` imports. */
  componentImports: Map<string, string>;
  /** Every other imported binding. */
  otherImports: Set<string>;
  /** Keys this component passes to `setContext` as string literals. */
  providedContexts: Set<string>;
};

/** Thrown for a component the analysis doesn't model (runes mode). */
export class UnsupportedComponentError extends Error {}

const RUNES = new Set(["$props", "$state", "$derived", "$effect", "$bindable"]);

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
): ComponentModel {
  const ast = parse(code, { comments: false });
  const model: ComponentModel = {
    key,
    code,
    ast,
    props: new Map(),
    propNames: new Map(),
    declarations: new Map(),
    reactiveDeclarations: new WeakSet(),
    unknownNames: new Set(),
    componentImports: new Map(),
    otherImports: new Set(),
    providedContexts: new Set(),
  };

  if (ast.options?.runes) {
    throw new UnsupportedComponentError(`${key} uses runes mode`);
  }

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
    if (topLevel.has(name)) model.unknownNames.add(name);
  }

  forEachNode(ast, (node) => {
    switch (node.type) {
      case "AssignmentExpression":
        if (!model.reactiveDeclarations.has(node)) {
          patternNames(node.left, model.unknownNames);
        }
        break;
      case "UpdateExpression":
        patternNames(node.argument, model.unknownNames);
        break;
      case "BindDirective":
        model.unknownNames.add(rootName(node.expression));
        break;
      case "CallExpression":
        if (node.callee.type === "Identifier") {
          if (RUNES.has(node.callee.name)) {
            throw new UnsupportedComponentError(`${key} uses runes`);
          }
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
      if (declarator.id.type !== "Identifier") {
        patternNames(declarator.id, model.unknownNames);
        continue;
      }
      const init = declarator.init ?? null;
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
    // A second definition, or one that redefines a prop or variable, is
    // just another assignment: the name becomes unknown.
    if (model.declarations.has(name) || model.props.has(name)) return;
    model.declarations.set(name, assignment.right);
    model.reactiveDeclarations.add(assignment);
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
