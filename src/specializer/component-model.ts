import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { analyzeScopes, type Binding, type Scopes } from "sveast/scope";
import {
  type AST,
  type Expression,
  extractIdentifiers,
  type Identifier,
  isReference,
  locate,
  type Pattern,
  type VariableDeclarator,
  walk,
} from "sveast/walk";
import { forEachNode, type Node } from "./ast";
import {
  createExportResolver,
  type Export,
  type ExportResolver,
} from "./exports";
import { parse } from "./parser";

/** Marks the names `pattern` declares as unknown, with why. */
function markUnknown(
  model: ComponentModel,
  pattern: Node | null | undefined,
  reason: string,
): void {
  if (!pattern) return;
  for (const { name } of extractIdentifiers(pattern as Pattern)) {
    markNameUnknown(model, name, reason);
  }
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

/** A function the analysis may call: its parameters and body. */
export type FunctionNode = Extract<
  Node,
  {
    type:
      | "FunctionDeclaration"
      | "FunctionExpression"
      | "ArrowFunctionExpression";
  }
>;

/** An exported function of one of the library's `.js` modules, and that module. */
type Helper = { model: ComponentModel; fn: FunctionNode };

/**
 * What the usage analysis needs to know about one library component, read
 * once from its source.
 */
export type ComponentModel = {
  /** Path relative to the library's `srcDir`, e.g. `Button/Button.svelte`. */
  key: string;
  /** The source `ast` was parsed from. */
  code: string;
  ast: AST.Root;
  /** What each name in `ast` refers to: see `isTopLevel`. */
  scopes: Scopes;
  /** `export let` props and their default expressions. */
  props: Map<string, Expression | null>;
  /**
   * Each prop's local name -> the name a parent passes it by: the same for
   * `export let kind`, `class` for `let className; export { className as class }`.
   */
  propNames: Map<string, string>;
  /**
   * `<svelte:options customElement>`: whatever renders it as an element
   * can set its props.
   */
  customElement: boolean;
  /** Top-level `let`/`const`, functions, and `$: x = …` declarations. */
  declarations: Map<string, Expression | null | typeof FUNCTION_DECLARATION>;
  /** Top-level `function` declarations, by name. */
  functions: Map<string, FunctionNode>;
  /** The `$: x = …` assignments that define a declaration above. */
  reactiveDeclarations: WeakSet<Node>;
  /**
   * Top-level names the analysis treats as unknown: assigned outside
   * their declaration (handlers, `bind:`, `$: if …`). A name a nested
   * scope declares is another binding (see `isTopLevel`).
   */
  unknownNames: Set<string>;
  /** Why each of `unknownNames` is unknown, for the report. */
  unknownReasons: Map<string, string>;
  /**
   * Top-level names whose only writes are `name = …` inside `$:`
   * statements, under `if` conditions: each write with the conditions it
   * runs under. A name keeps its declared value and adds each write's
   * value unless one of its conditions can't hold.
   */
  guardedWrites: Map<string, GuardedWrite[]>;
  /** Local binding -> library module key, for relative `.svelte` imports. */
  componentImports: Map<string, string>;
  /** Every other imported binding. */
  otherImports: Set<string>;
  /** Imported bindings of other packages, by local name: their specifier. */
  packageImports: Map<string, string>;
  /**
   * Imported bindings of library objects with components as members, by
   * local name: `import * as L from "./…"`, a namespace re-export, or a
   * component with members (`Object.assign(Root, { Item })`).
   */
  memberImports: Map<string, Export>;
  /**
   * Imported bindings of a library module's `export const NAME = "…"`, by
   * local name: the strings a context key can be (see `contextKey`).
   */
  importedStrings: Map<string, string>;
  /**
   * Imported bindings of a library `.js` module's exported functions, by
   * local name, read when first called.
   */
  importedHelpers: Map<string, () => Helper | undefined>;
  /** Bindings imported from `svelte/store`, by local name: `readable`. */
  storeImports: Map<string, string>;
  /** Keys this component passes to `setContext` (see `contextKey`). */
  providedContexts: Set<string>;
  /** It passes `setContext` a key the analysis can't read. */
  providesUnknownContext: boolean;
  /**
   * What each `setContext` call passes, by key: an object literal's
   * properties, each a `MirroredStore` or something else (`null`). `null`
   * for a value that isn't such a literal.
   */
  contextObjects: Map<string, Array<Map<string, MirroredStore | null> | null>>;
  /**
   * The properties of each context it reads that it may write to or hand
   * on (`"*"` for all of them): any use but subscribing to a store it
   * reads into a `const`.
   */
  contextLeaks: Map<string, Set<string>>;
  /** It calls `getContext` with a key it can't read, or `getAllContexts`. */
  readsUnknownContext: boolean;
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
type Escape = { full: boolean; paths: string[][] };

/** An enclosing `if` test, and whether what it guards is on its true side. */
type Guard = { test: Expression; holds: boolean };

/** A write `name = value` under `if` conditions in a `$:` statement. */
export type GuardedWrite = {
  guards: Guard[];
  value: Expression;
  line: number;
};

/**
 * A `const s = writable(initial)` the component sets only from `$:`
 * statements (`$: $s = a`, `$: s.set(a)`) and hands on only as a property
 * of a context object: it holds `initial` or one of `writes`. `readOnly`
 * when handed on as `readonly(s)`, which no reader can set.
 */
export type MirroredStore = {
  initial: Expression | null;
  writes: Expression[];
  readOnly: boolean;
};

/** Thrown for a component the analysis can't model. */
export class UnsupportedComponentError extends Error {}

/** Runes whose argument is the value they declare. */
const VALUE_RUNES = new Set(["$state", "$state.raw", "$derived"]);

/**
 * The rune `declarator`'s initializer calls (`$state`, `$props`), unless a
 * binding or a store shadows it (see `Binding.rune`), and its argument.
 */
function runeCall(
  model: ComponentModel,
  declarator: VariableDeclarator,
): { rune: string; argument: Expression | null } | undefined {
  const [id] = extractIdentifiers(declarator.id as Pattern);
  const rune = id && model.scopes.bindingOf(id)?.rune;
  const { init } = declarator;
  if (!rune || init?.type !== "CallExpression") return undefined;
  const [first] = init.arguments;
  return {
    rune,
    argument: first && first.type !== "SpreadElement" ? first : null,
  };
}

const cache = new Map<string, { mtimeMs: number; model: ComponentModel }>();

/**
 * Reads and models `key` under `src`. Cached by absolute path and
 * modification time, so a linked library checkout edited between
 * `vite build --watch` rebuilds is read again.
 */
export function loadComponentModel(src: string, key: string): ComponentModel {
  const file = path.join(src, key);
  const { mtimeMs } = statSync(file);
  const cached = cache.get(file);
  if (cached?.mtimeMs === mtimeMs) return cached.model;
  const model = buildComponentModel(
    readFileSync(file, "utf8"),
    key,
    libraryResolver(src),
  );
  cache.set(file, { mtimeMs, model });
  return model;
}

const exportResolvers = new Map<
  string,
  { checked: number; resolver: ExportResolver }
>();

/** What the library's modules under `src` export: read once per analysis. */
function exportsUnder(src: string): ExportResolver {
  let cached = exportResolvers.get(src);
  if (cached?.checked !== analysisCount) {
    cached = { checked: analysisCount, resolver: createExportResolver(src) };
    exportResolvers.set(src, cached);
  }
  return cached.resolver;
}

/** Resolves a library module's relative imports: see `ImportResolver`. */
function libraryResolver(src: string): ImportResolver {
  return (from, source, name) => {
    const exported = exportsUnder(src).importOf(from, source, name);
    if (exported.kind === "component") return { component: exported.key };
    if (exported.kind === "members") return { members: exported };
    if (name === "*") return undefined;
    const module = scriptModule(src, from, source);
    if (!module) return undefined;
    const string = stringExport(src, module, name);
    return string !== undefined
      ? { string }
      : { helper: () => loadHelper(src, module, name) };
  };
}

/** The `.js` module `source` names from module `from`, if it exists. */
function scriptModule(
  src: string,
  from: string,
  source: string,
): string | undefined {
  const joined = path.posix.join(path.posix.dirname(from), source);
  return [joined, `${joined}.js`].find(
    (candidate) =>
      candidate.endsWith(".js") && existsSync(path.join(src, candidate)),
  );
}

const scriptCache = new Map<
  string,
  { mtimeMs: number; checked: number; model: ComponentModel | undefined }
>();

/**
 * Counts analyses: a `.js` module's mtime is checked once per analysis,
 * not on every call into one of its helpers.
 */
let analysisCount = 0;

/** Starts an analysis: `.js` modules a helper call reads are checked again. */
export function recheckScriptModels(): void {
  analysisCount++;
}

/**
 * The library's `.js` module `key`, modeled as a module script. Every name it
 * exports may be changed by an importer, so an object one holds is never
 * known (see `escapes`). `undefined` if it doesn't parse.
 */
function loadScriptModel(src: string, key: string): ComponentModel | undefined {
  const file = path.join(src, key);
  const cached = scriptCache.get(file);
  if (cached?.checked === analysisCount) return cached.model;
  const { mtimeMs } = statSync(file);
  if (cached?.mtimeMs === mtimeMs) {
    cached.checked = analysisCount;
    return cached.model;
  }
  let model: ComponentModel | undefined;
  try {
    model = buildComponentModel(
      `<script context="module">\n${readFileSync(file, "utf8")}\n</script>`,
      key,
      libraryResolver(src),
    );
    for (const statement of model.ast.module?.content.body ?? []) {
      if (statement.type !== "ExportNamedDeclaration") continue;
      const names = statement.declaration
        ? statement.declaration.type === "VariableDeclaration"
          ? statement.declaration.declarations.flatMap((declarator) =>
              extractIdentifiers(declarator.id as Pattern),
            )
          : []
        : statement.specifiers.flatMap((specifier) =>
            specifier.local.type === "Identifier" ? [specifier.local] : [],
          );
      for (const { name } of names) {
        model.escapes.set(name, { full: true, paths: [] });
      }
    }
  } catch {
    model = undefined;
  }
  scriptCache.set(file, { mtimeMs, checked: analysisCount, model });
  return model;
}

/** The function `.js` module `key` exports as `name`, if it declares one. */
function loadHelper(
  src: string,
  key: string,
  name: string,
): Helper | undefined {
  const model = loadScriptModel(src, key);
  // A function the module reassigns may not be the one declared.
  if (!model || model.unknownNames.has(name)) return undefined;
  for (const statement of model.ast.module?.content.body ?? []) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const { declaration } = statement;
    if (declaration?.type === "FunctionDeclaration") {
      if (declaration.id?.name === name) {
        return { model, fn: declaration as FunctionNode };
      }
    } else if (declaration?.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations) {
        if (
          declaration.kind === "const" &&
          declarator.id.type === "Identifier" &&
          declarator.id.name === name &&
          (declarator.init?.type === "ArrowFunctionExpression" ||
            declarator.init?.type === "FunctionExpression")
        ) {
          return { model, fn: declarator.init as FunctionNode };
        }
      }
    }
  }
  return undefined;
}

/**
 * What `import { name } from source` binds in module `from` (`"*"` for a
 * namespace): a library component, an object with components as
 * members, a string a library module's `export const` holds, or a library
 * module's function.
 */
type ImportResolver = (
  from: string,
  source: string,
  name: string,
) =>
  | { component: string }
  | { members: Export }
  | { string: string }
  | { helper: () => Helper | undefined }
  | undefined;

/**
 * The string `.js` module `module` exports as `name`, when it declares it
 * as `export const name = "…"`, on its own line, once. Re-exports aren't
 * followed.
 */
function stringExport(
  src: string,
  module: string,
  name: string,
): string | undefined {
  const code = readFileSync(path.join(src, module), "utf8");
  const declaration = new RegExp(
    `^export const ${name.replaceAll("$", "\\$")} = (["'])([^"'\\\\\\n]*)\\1;?[ \\t]*$`,
    "gm",
  );
  const matches = [...code.matchAll(declaration)];
  return matches.length === 1 ? matches[0][2] : undefined;
}

export function buildComponentModel(
  code: string,
  key: string,
  resolveImport: ImportResolver = () => undefined,
  /** `code` already parsed, to skip parsing it again. */
  parsed?: AST.Root,
): ComponentModel {
  const ast = parsed ?? parse(code, { comments: false, css: false });
  const model: ComponentModel = {
    key,
    code,
    ast,
    scopes: analyzeScopes(ast),
    props: new Map(),
    propNames: new Map(),
    customElement:
      ast.options?.attributes.some(
        (attribute) => attribute.name === "customElement",
      ) ?? false,
    declarations: new Map(),
    functions: new Map(),
    reactiveDeclarations: new WeakSet(),
    unknownNames: new Set(),
    unknownReasons: new Map(),
    guardedWrites: new Map(),
    componentImports: new Map(),
    otherImports: new Set(),
    packageImports: new Map(),
    memberImports: new Map(),
    importedStrings: new Map(),
    importedHelpers: new Map(),
    storeImports: new Map(),
    providedContexts: new Set(),
    providesUnknownContext: false,
    contextObjects: new Map(),
    contextLeaks: new Map(),
    readsUnknownContext: false,
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

  // Each identifier that writes or mutates a top-level binding, and the
  // name that it makes unknown: `$count = 1` sets the store's value.
  const writes = new Map<Identifier, string>();
  for (const binding of topLevelBindings(model.scopes)) {
    // `x` in `$: x = …` declares it, so it's no reference; it's a write
    // unless the model reads it as the definition (`reactiveDeclarations`).
    if (binding.kind === "reactive" && binding.node) {
      writes.set(binding.node, binding.name);
    }
    for (const reference of binding.references) {
      if (reference.writes || reference.mutates) {
        writes.set(
          reference.node,
          reference.store ? `$${binding.name}` : binding.name,
        );
      }
    }
  }
  /** Names written after their declaration: a rest name among them is unusable. */
  const written = new Set<string>();
  const markWritten = (target: Node | null | undefined, reason: string) =>
    forEachNode(target, (node) => {
      const name = node.type === "Identifier" && writes.get(node);
      if (!name) return;
      writes.delete(node);
      markNameUnknown(model, name, reason);
      written.add(name);
    });
  const line = (offset: number) => locate(code, offset).line;
  const reactive = reactiveStatements(ast);
  forEachNode(ast, (node) => {
    switch (node.type) {
      case "AssignmentExpression": {
        const guards = reactive.get(node);
        if (model.reactiveDeclarations.has(node)) {
          // `$: x = …` defines `x` rather than writing it.
          forEachNode(node.left as Node, (target) => {
            if (target.type === "Identifier") writes.delete(target);
          });
        } else if (
          guards?.length &&
          node.operator === "=" &&
          node.left.type === "Identifier" &&
          // `$store = …` sets a store other components may share.
          !node.left.name.startsWith("$") &&
          writes.get(node.left) === node.left.name
        ) {
          const { name } = node.left;
          writes.delete(node.left);
          const list = model.guardedWrites.get(name) ?? [];
          list.push({ guards, value: node.right, line: line(node.start) });
          model.guardedWrites.set(name, list);
        } else {
          markWritten(node.left, `is assigned at line ${line(node.start)}`);
        }
        break;
      }
      case "UpdateExpression":
        markWritten(node.argument, `is updated at line ${line(node.start)}`);
        break;
      case "BindDirective":
        markWritten(
          node.expression,
          `is bound with \`bind:\` at line ${line(node.start)}`,
        );
        break;
      case "CallExpression":
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "setContext"
        ) {
          const key = contextKey(node.arguments[0] as Node | undefined, model);
          if (key === undefined) model.providesUnknownContext = true;
          else model.providedContexts.add(key);
        }
        break;
    }
  });
  // Any other write, such as `for (x of xs)`.
  for (const [node, name] of writes) {
    markNameUnknown(model, name, `is assigned at line ${line(node.start)}`);
    written.add(name);
  }

  if (model.restPropsName && written.has(model.restPropsName)) {
    model.restPropsName = undefined;
  }

  readContextFlow(model, reactive);
  return model;
}

const CONTEXT_CALL = /\b(?:get|set)Context\b|\bgetAllContexts\b/;

/**
 * Fills `contextObjects`, `contextLeaks` and `readsUnknownContext`: what
 * flows through the contexts the component sets and reads.
 */
function readContextFlow(
  model: ComponentModel,
  reactive: Map<Node, Guard[]>,
): void {
  const { ast, code } = model;
  if (!CONTEXT_CALL.test(code)) return;
  const parents = new Map<Node, Node | null>();
  walk(ast, {
    enter(node, parent) {
      parents.set(node as Node, (parent as Node | null) ?? null);
    },
  });
  const leak = (key: string, property: string) => {
    const leaked = model.contextLeaks.get(key) ?? new Set<string>();
    leaked.add(property);
    model.contextLeaks.set(key, leaked);
  };
  forEachNode(ast, (node) => {
    if (node.type !== "CallExpression" || node.callee.type !== "Identifier") {
      return;
    }
    const [first, second] = node.arguments as Node[];
    if (node.callee.name === "getAllContexts") {
      model.readsUnknownContext = true;
    } else if (node.callee.name === "getContext") {
      const key = contextKey(first, model);
      if (key === undefined) model.readsUnknownContext = true;
      else readContextUse(model, node, key, parents, leak);
    } else if (node.callee.name === "setContext") {
      const key = contextKey(first, model);
      if (key === undefined) return;
      const objects = model.contextObjects.get(key) ?? [];
      objects.push(contextObject(model, second, parents, reactive));
      model.contextObjects.set(key, objects);
    }
  });
}

/**
 * The properties of the object literal `node` passes to `setContext`
 * (inline, or a `const` nothing else uses), each a `MirroredStore` or
 * `null`. `null` for anything else.
 */
function contextObject(
  model: ComponentModel,
  node: Node | undefined,
  parents: Map<Node, Node | null>,
  reactive: Map<Node, Guard[]>,
): Map<string, MirroredStore | null> | null {
  let object = node;
  if (node?.type === "Identifier") {
    const constant = topLevelConstant(model, node);
    if (constant?.binding.references.length !== 1) return null;
    object = constant.declarator.init as Node | undefined;
  }
  if (object?.type !== "ObjectExpression") return null;
  const properties = new Map<string, MirroredStore | null>();
  for (const property of object.properties as Node[]) {
    if (property.type !== "Property" || property.kind !== "init") return null;
    const name = propertyName(property);
    if (name === undefined) return null;
    const { value } = property;
    // `readonly(s)` from `svelte/store`
    const wrapped =
      value.type === "CallExpression" &&
      value.callee.type === "Identifier" &&
      model.storeImports.get(value.callee.name) === "readonly" &&
      value.arguments.length === 1 &&
      value.arguments[0].type === "Identifier"
        ? value.arguments[0]
        : undefined;
    const store =
      value.type === "Identifier"
        ? mirroredStore(model, value, property, parents, reactive)
        : wrapped
          ? mirroredStore(model, wrapped, value as Node, parents, reactive)
          : null;
    properties.set(
      name,
      store && { ...store, readOnly: wrapped !== undefined },
    );
  }
  return properties;
}

/** The declaration of `id` when it names a top-level `const`. */
function topLevelConstant(model: ComponentModel, id: Identifier) {
  const binding = model.scopes.bindingOf(id);
  const declarator = binding?.declaration as Node | undefined;
  return binding &&
    isTopLevel(binding, model) &&
    binding.kind === "const" &&
    declarator?.type === "VariableDeclarator"
    ? { binding, declarator }
    : undefined;
}

/** A property's key, unless it's computed from something other than a literal. */
export function propertyName(property: Extract<Node, { type: "Property" }>) {
  if (!property.computed && property.key.type === "Identifier") {
    return property.key.name;
  }
  return property.key.type === "Literal"
    ? String(property.key.value)
    : undefined;
}

/**
 * The store `id` names, when it's a `MirroredStore` handed on in `holder`
 * (a property, or `readonly(id)`): every other use of the name subscribes
 * to it, or sets it as a whole statement of a `$:` statement.
 */
function mirroredStore(
  model: ComponentModel,
  id: Identifier,
  holder: Node,
  parents: Map<Node, Node | null>,
  reactive: Map<Node, Guard[]>,
): Omit<MirroredStore, "readOnly"> | null {
  const constant = topLevelConstant(model, id);
  if (!constant) return null;
  const { binding, declarator } = constant;
  if (
    declarator.init?.type !== "CallExpression" ||
    declarator.init.callee.type !== "Identifier" ||
    model.storeImports.get(declarator.init.callee.name) !== "writable" ||
    declarator.init.arguments.length > 1 ||
    declarator.init.arguments[0]?.type === "SpreadElement"
  ) {
    return null;
  }
  const writes: Expression[] = [];
  for (const reference of binding.references) {
    const parent = reference.parent as Node;
    if (parent === holder) {
      // Handed on here, and nowhere else.
    } else if (reference.store && !reference.writes && !reference.mutates) {
      // `$s`: reads it.
    } else if (
      reference.store &&
      parent.type === "AssignmentExpression" &&
      parent.operator === "=" &&
      parent.left === reference.node &&
      reactive.has(parent)
    ) {
      writes.push(parent.right);
    } else if (
      !reference.store &&
      parent.type === "MemberExpression" &&
      parent.object === reference.node &&
      !parent.computed &&
      parent.property.type === "Identifier" &&
      parent.property.name === "set"
    ) {
      const call = parents.get(parent);
      const [value] = call?.type === "CallExpression" ? call.arguments : [];
      if (
        call?.type !== "CallExpression" ||
        call.callee !== parent ||
        call.arguments.length !== 1 ||
        value.type === "SpreadElement" ||
        !reactive.has(call)
      ) {
        return null;
      }
      writes.push(value);
    } else {
      return null;
    }
  }
  const [initial] = declarator.init.arguments as Expression[];
  return { initial: initial ?? null, writes };
}

/**
 * Records in `contextLeaks` what the component may write to or hand on
 * from the context `call` reads: nothing for a property read into a
 * `const` it only subscribes to (`const s = ctx?.s ?? readable(x)`, or
 * `const { s } = getContext(k)`), the property for any other read, and
 * every property (`"*"`) when the context itself goes anywhere else.
 */
function readContextUse(
  model: ComponentModel,
  call: Node,
  key: string,
  parents: Map<Node, Node | null>,
  leak: (key: string, property: string) => void,
): void {
  let value: Node = call;
  let parent = parents.get(call);
  // `getContext(k) ?? {}`
  if (parent?.type === "LogicalExpression" && parent.left === value) {
    value = parent;
    parent = parents.get(parent);
  }
  const declarator = topLevelConst(model, parent, value);
  if (!declarator) {
    leak(key, "*");
    return;
  }
  if (declarator.id.type === "ObjectPattern") {
    for (const property of declarator.id.properties as Node[]) {
      const name =
        property.type === "Property" ? propertyName(property) : undefined;
      if (property.type !== "Property" || name === undefined) {
        leak(key, "*");
        return;
      }
      const target =
        property.value.type === "AssignmentPattern"
          ? property.value.left
          : property.value;
      if (target.type !== "Identifier" || !onlySubscribed(model, target)) {
        leak(key, name);
      }
    }
    return;
  }
  if (declarator.id.type !== "Identifier") {
    leak(key, "*");
    return;
  }
  const binding = model.scopes.bindingOf(declarator.id);
  for (const reference of binding?.references ?? []) {
    const parent = reference.parent as Node;
    if (reference.writes || reference.mutates) {
      leak(key, "*");
      return;
    }
    if (
      parent.type === "MemberExpression" &&
      parent.object === reference.node &&
      !parent.computed &&
      parent.property.type === "Identifier"
    ) {
      const name = parent.property.name;
      let read: Node = parent;
      let up = parents.get(read);
      if (up?.type === "ChainExpression") {
        read = up;
        up = parents.get(up);
      }
      // `ctx?.s ?? readable(false)`
      if (up?.type === "LogicalExpression" && up.left === read) {
        read = up;
        up = parents.get(up);
      }
      const alias = topLevelConst(model, up, read);
      if (alias?.id.type !== "Identifier" || !onlySubscribed(model, alias.id)) {
        leak(key, name);
      }
    } else if (
      !(parent.type === "IfStatement" && parent.test === reference.node) &&
      !(
        parent.type === "ConditionalExpression" &&
        parent.test === reference.node
      ) &&
      !(parent.type === "UnaryExpression" && parent.operator === "!")
    ) {
      leak(key, "*");
      return;
    }
  }
}

/** `parent`, when it's a top-level `const` declarator initialized to `init`. */
function topLevelConst(
  model: ComponentModel,
  parent: Node | null | undefined,
  init: Node,
): Extract<Node, { type: "VariableDeclarator" }> | undefined {
  if (parent?.type !== "VariableDeclarator" || parent.init !== init) {
    return undefined;
  }
  const declaration = model.ast.instance?.content.body.find(
    (statement) =>
      statement.type === "VariableDeclaration" &&
      statement.kind === "const" &&
      statement.declarations.includes(parent as never),
  );
  return declaration ? parent : undefined;
}

/** Whether every use of the name `id` declares is a `$id` store read. */
function onlySubscribed(model: ComponentModel, id: Identifier): boolean {
  const binding = model.scopes.bindingOf(id);
  return (
    binding?.references.every(
      (reference) => reference.store && !reference.writes && !reference.mutates,
    ) ?? false
  );
}

/**
 * The expressions the instance script's `$:` statements run as statements
 * (`$: $s = a`, `$: if (a) x = true`), each with the `if` conditions it
 * runs under. Any other statement or expression on the way (a loop, `&&`,
 * a function) leaves an expression out.
 */
function reactiveStatements(ast: AST.Root): Map<Node, Guard[]> {
  const found = new Map<Node, Guard[]>();
  const visit = (node: Node, guards: Guard[]): void => {
    switch (node.type) {
      case "BlockStatement":
        for (const statement of node.body) visit(statement as Node, guards);
        return;
      case "IfStatement":
        visit(node.consequent as Node, [
          ...guards,
          { test: node.test, holds: true },
        ]);
        if (node.alternate) {
          visit(node.alternate as Node, [
            ...guards,
            { test: node.test, holds: false },
          ]);
        }
        return;
      case "ExpressionStatement":
        found.set(node.expression as Node, guards);
        return;
    }
  };
  for (const statement of (ast.instance?.content.body ?? []) as Node[]) {
    if (statement.type === "LabeledStatement" && statement.label.name === "$") {
      visit(statement.body as Node, []);
    }
  }
  return found;
}

/**
 * Declares each name `pattern` binds as the read of its path from `read`
 * (`init.b`, `init[0]`), defaults applied where that's `undefined`. A
 * rest element, or a computed key, is unknown.
 */
function declareDestructured(
  model: ComponentModel,
  pattern: Node,
  read: Expression,
  lets: Set<string> | undefined,
): void {
  // The read takes the pattern's place in the source, for reports.
  const at = {
    start: (pattern as { start: number }).start,
    end: (pattern as { end: number }).end,
  };
  const member = (property: Expression, computed: boolean) =>
    ({
      type: "MemberExpression",
      object: read,
      property,
      computed,
      optional: false,
      ...at,
    }) as unknown as Expression;
  switch (pattern.type) {
    case "Identifier":
      model.declarations.set(pattern.name, read);
      lets?.add(pattern.name);
      return;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        const key =
          property.type !== "Property"
            ? undefined
            : !property.computed && property.key.type === "Identifier"
              ? property.key.name
              : property.key.type === "Literal" &&
                  typeof property.key.value === "string"
                ? property.key.value
                : undefined;
        if (property.type !== "Property" || key === undefined) {
          markUnknown(
            model,
            (property.type === "RestElement"
              ? property.argument
              : property.value) as Node,
            "is declared by destructuring",
          );
          continue;
        }
        declareDestructured(
          model,
          property.value as Node,
          member({ type: "Identifier", name: key } as Expression, false),
          lets,
        );
      }
      return;
    case "ArrayPattern":
      for (const [index, element] of pattern.elements.entries()) {
        if (!element) continue;
        if (element.type === "RestElement") {
          markUnknown(
            model,
            element.argument as Node,
            "is declared by destructuring",
          );
          continue;
        }
        declareDestructured(
          model,
          element as Node,
          member({ type: "Literal", value: index } as Expression, true),
          lets,
        );
      }
      return;
    case "AssignmentPattern":
      declareDestructured(
        model,
        pattern.left as Node,
        {
          type: "ConditionalExpression",
          test: {
            type: "BinaryExpression",
            operator: "===",
            left: read,
            right: { type: "Identifier", name: "undefined" },
          },
          consequent: pattern.right,
          alternate: read,
          ...at,
        } as unknown as Expression,
        lets,
      );
      return;
    default:
      markUnknown(model, pattern, "is declared by destructuring");
  }
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
    const relative = source.startsWith(".");
    for (const specifier of statement.specifiers) {
      if (!relative) model.packageImports.set(specifier.local.name, source);
      const imported =
        specifier.type === "ImportDefaultSpecifier"
          ? "default"
          : specifier.type === "ImportNamespaceSpecifier"
            ? "*"
            : specifier.imported.type === "Identifier"
              ? specifier.imported.name
              : undefined;
      const resolved =
        relative && imported
          ? resolveImport(model.key, source, imported)
          : undefined;
      if (resolved && "component" in resolved) {
        model.componentImports.set(specifier.local.name, resolved.component);
      } else {
        model.otherImports.add(specifier.local.name);
        if (resolved && "members" in resolved) {
          model.memberImports.set(specifier.local.name, resolved.members);
        } else if (resolved && "string" in resolved) {
          model.importedStrings.set(specifier.local.name, resolved.string);
        } else if (resolved) {
          model.importedHelpers.set(specifier.local.name, resolved.helper);
        }
      }
      if (source === "svelte/store" && imported) {
        model.storeImports.set(specifier.local.name, imported);
      }
    }
    return;
  }

  const isExport = statement.type === "ExportNamedDeclaration";
  const declaration = isExport ? statement.declaration : statement;
  if (!declaration) return;

  if (declaration.type === "VariableDeclaration") {
    for (const declarator of declaration.declarations) {
      const rune = runeCall(model, declarator);
      if (rune?.rune === "$props" && isInstance) {
        readPropsRune(model, declarator.id as Node);
        continue;
      }
      if (declarator.id.type !== "Identifier") {
        if (isExport || rune || !declarator.init) {
          markUnknown(
            model,
            declarator.id as Node,
            "is declared by destructuring",
          );
        } else {
          // `const { a, b: c = 1 } = init`: each name reads its path.
          declareDestructured(
            model,
            declarator.id as Node,
            declarator.init as Expression,
            declaration.kind === "let" ? lets : undefined,
          );
        }
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
    model.functions.set(declaration.id.name, declaration as FunctionNode);
    return;
  }

  const assignment =
    statement.type === "LabeledStatement" &&
    statement.label.name === "$" &&
    statement.body.type === "ExpressionStatement" &&
    statement.body.expression.type === "AssignmentExpression" &&
    statement.body.expression.operator === "="
      ? statement.body.expression
      : undefined;
  if (assignment?.left.type === "ObjectPattern") {
    // `$: ({ a, b: c } = f())` defines each name as a read of `f()`.
    const names = extractIdentifiers(assignment.left as Pattern).map(
      ({ name }) => name,
    );
    if (
      names.some(
        (name) =>
          name.startsWith("$") ||
          model.declarations.has(name) ||
          model.props.has(name),
      )
    ) {
      return;
    }
    declareDestructured(
      model,
      assignment.left as Node,
      assignment.right,
      undefined,
    );
    model.reactiveDeclarations.add(assignment);
  } else if (assignment?.left.type === "Identifier") {
    const { name } = assignment.left;
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
 * component's props and a slot's are handed on).
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
          element?.type === "SvelteSelf" ||
          element?.type === "SlotElement")
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
  /**
   * `[array, item, destructured]` for each `{#each array as item}`, and
   * for each name `{#each array as { a, b }}` declares.
   */
  const eachItems: Array<[string, string, boolean]> = [];
  const stack: Node[] = [];
  walk(ast, {
    enter(node, parent, key) {
      stack.push(node as Node);
      if (
        node.type === "EachBlock" &&
        node.expression.type === "Identifier" &&
        node.context
      ) {
        const array = node.expression.name;
        if (node.context.type === "Identifier") {
          eachItems.push([array, node.context.name, false]);
        } else {
          for (const { name } of extractIdentifiers(node.context as Pattern)) {
            eachItems.push([array, name, true]);
          }
        }
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
  // handed on is a path that matters only if items are objects. A name
  // destructured from an item is some path of it, so the whole item.
  for (const [array, item, destructured] of eachItems.reverse()) {
    const itemEscape = escapes.get(item);
    if (!itemEscape) continue;
    const target = entry(array);
    if (itemEscape.full || destructured) target.paths.push(["[]"]);
    for (const path of itemEscape.paths) target.paths.push(["[]", ...path]);
  }
  return escapes;
}

/** `x` in `<object>.x` or `<object>["x"]`, if `parent` is such a member. */
export function memberKey(parent: Node | null): string | undefined {
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
    // Its default, without `$bindable(…)`.
    const binding = model.scopes.bindingOf(local);
    model.props.set(
      local.name,
      binding ? (binding.initial as Expression | null) : fallback,
    );
    model.propNames.set(local.name, passedAs);
  }
}

/** The bindings `<script module>` and `<script>` declare at their top level. */
function topLevelBindings(scopes: Scopes): Binding[] {
  const bindings = [...scopes.instance.declarations.values()];
  if (scopes.module !== scopes.instance) {
    bindings.push(...scopes.module.declarations.values());
  }
  return bindings;
}

/**
 * The key a `getContext` or `setContext` call passes as `node`: a string
 * literal, or an imported `export const` string (`FORM_CONTEXT_KEY`).
 * `undefined` for anything else.
 */
export function contextKey(
  node: Node | undefined,
  model: ComponentModel,
): string | undefined {
  if (node?.type === "Literal") {
    return typeof node.value === "string" ? node.value : undefined;
  }
  if (node?.type !== "Identifier") return undefined;
  const binding = model.scopes.bindingOf(node);
  return binding && isTopLevel(binding, model)
    ? model.importedStrings.get(node.name)
    : undefined;
}

/**
 * Whether `binding` is one of the component's own names, declared at the
 * top level of a `<script>`, rather than a nested scope's (a parameter, a
 * local, an `{#each}` item, `let:`, a snippet parameter, `{@const}`, an
 * `{#await}` value) that only reuses the name.
 */
export function isTopLevel(binding: Binding, model: ComponentModel): boolean {
  return (
    binding.scope === model.scopes.instance ||
    binding.scope === model.scopes.module
  );
}
