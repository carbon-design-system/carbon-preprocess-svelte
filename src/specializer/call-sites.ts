import path from "node:path";
import { lexImportsExports } from "sveast/lexer";
import { type AST, children, type Expression, locate } from "sveast/walk";
import { forEachNode, type Node } from "./ast";
import { buildComponentModel, type ComponentModel } from "./component-model";
import {
  bindEach,
  createScope,
  evaluate,
  type PassedProp,
  type Scope,
  spreadProps,
  whyUnknownLater,
} from "./evaluate";
import { importKey } from "./import-key";
import type { Library } from "./library";
import { callSiteFromElement, type Explain } from "./live-walk";
import { parse } from "./parser";
import { type CallSite, type ComponentUsage, newComponentUsage } from "./usage";
import {
  EMPTY_ARRAY,
  isEmptyArray,
  OBJECT,
  possible,
  truthOf,
  UNDEFINED,
  UNKNOWN,
  type Value,
} from "./values";

/** What one app module contributes to the analysis. */
export type ModuleUsage = {
  /**
   * Its call sites: of library components (keyed like `Button/Button.svelte`)
   * and, when `AppComponents` are given, of the app's own `.svelte` files
   * (keyed by absolute path).
   */
  sites: CallSite[];
  /** Every bundled library component may render with any props. */
  openAll: boolean;
  /**
   * It imports `.svelte` files in a way the analysis can't follow (a
   * computed `import()`, `import.meta.glob`): every app component may
   * render with any props.
   */
  openApps?: boolean;
  /**
   * Library context keys the module may pass to `setContext`: every
   * string it holds that starts with `LibrarySpec.contextKeyPrefix`, so a
   * key kept in a constant counts.
   */
  providedContexts: Set<string>;
  /**
   * It calls `setContext` with what may be a library key it doesn't
   * spell out (see `providesUnknownContext`).
   */
  providesUnknownContext?: boolean;
  /**
   * It may read a library context (`getContext` or `getAllContexts`, and
   * a library key or one of its script modules), and so write to the
   * stores one hands on.
   */
  readsLibraryContext?: boolean;
  /** The file it was read from. */
  file?: string;
  /** What it imports from the library, as read. */
  libraryImports?: LibraryImports;
};

/** What a module imports from the library, as the analysis read it. */
export type LibraryImports = {
  /** Keys of the components it imports, re-exports or loads by path. */
  components: Set<string>;
  /** It imports something from the barrel. */
  barrel: boolean;
};

/**
 * Whether the analysis read `usage`'s import of library module `key`
 * (`index.js` for the barrel). A bundler's module graph with an edge the
 * analysis didn't read means an import it can't see, such as one through
 * an alias (`import { Button } from "@lib"`).
 */
export function readLibraryImport(
  library: Library,
  usage: ModuleUsage | undefined,
  key: string,
): boolean {
  if (!usage) return false;
  if (usage.openAll) return true;
  const imports = usage.libraryImports;
  if (!imports) return false;
  return key === library.barrelKey
    ? imports.barrel
    : imports.components.has(key);
}

/** The app's own `.svelte` files the analysis reads, for resolving imports of them. */
export type AppComponents = {
  files: ReadonlySet<string>;
  /** File name -> files, for imports through an alias (`$lib/X.svelte`). */
  byName: ReadonlyMap<string, string[]>;
  /**
   * Non-relative imports the bundler resolved to one of `files`, by
   * `importKey(from, source)`: `$lib/X.svelte` resolves exactly then.
   */
  resolved?: ReadonlyMap<string, string>;
};

export function indexAppComponents(
  files: Iterable<string>,
  resolved?: ReadonlyMap<string, string>,
): AppComponents {
  const byName = new Map<string, string[]>();
  const set = new Set<string>();
  for (const file of files) {
    set.add(file);
    const name = path.basename(file);
    const named = byName.get(name);
    if (named) named.push(file);
    else byName.set(name, [file]);
  }
  return { files: set, byName, resolved };
}

/** Whether `key` names an app component (an absolute path), not a library one. */
export function isAppComponent(key: string): boolean {
  return path.isAbsolute(key);
}

/**
 * The app components `source`, imported from `from`, can be: exactly one
 * for a relative path to a known file; every file of the same name for an
 * alias or package path (`$lib/Card.svelte`), which can't be told apart.
 * Without `.svelte`, a bundler that adds the extension (webpack's
 * `resolve.extensions`) may still load one: `./Card` can be `Card.svelte`
 * or `Card/index.svelte`, and those are possible but not certain.
 */
function resolveAppImport(
  library: Library,
  from: string,
  source: string,
  apps: AppComponents,
): { keys: string[]; exact: boolean } | undefined {
  if (source.startsWith(library.srcPrefix)) return undefined;
  if (source.endsWith(".svelte")) {
    if (source.startsWith(".")) {
      const file = path.resolve(path.dirname(from), source);
      return apps.files.has(file) ? { keys: [file], exact: true } : undefined;
    }
    const resolved = apps.resolved?.get(importKey(from, source));
    if (resolved && apps.files.has(resolved)) {
      return { keys: [resolved], exact: true };
    }
    const keys = apps.byName.get(path.posix.basename(source));
    return keys ? { keys, exact: false } : undefined;
  }
  const keys = source.startsWith(".")
    ? [path.resolve(path.dirname(from), source)].flatMap((file) =>
        [`${file}.svelte`, path.join(file, "index.svelte")].filter((key) =>
          apps.files.has(key),
        ),
      )
    : [
        ...(apps.byName.get(`${path.posix.basename(source)}.svelte`) ?? []),
        ...(apps.byName.get("index.svelte") ?? []).filter(
          (key) =>
            path.basename(path.dirname(key)) === path.posix.basename(source),
        ),
      ];
  return keys.length > 0 ? { keys, exact: false } : undefined;
}

const DYNAMIC_IMPORT = /\b(?:import|require)\s*\(/g;
/** The literal argument of an `import(`, read from where it ends. */
const LITERAL_IMPORT = /\s*(["'`])([^"'`$]+)\1\s*\)/y;
const IMPORT_META_GLOB = /\bimport\.meta\.glob\b/;

/**
 * `import()`, `require()` and `import.meta.glob` in `code`, which the
 * lexer doesn't read. One of a library component or an app component
 * renders it with any props; one of the library's barrel, or computed from
 * its name, may render any library component; any other computed one
 * may render any app component.
 */
function readDynamicImports(
  library: Library,
  code: string,
  bindings: ImportBindings,
  app: AppImports,
): void {
  if (!code.includes("import") && !code.includes("require")) return;
  if (IMPORT_META_GLOB.test(code)) bindings.openApps = true;
  for (const match of code.matchAll(DYNAMIC_IMPORT)) {
    const start = match.index + match[0].length;
    LITERAL_IMPORT.lastIndex = start;
    const source = LITERAL_IMPORT.exec(code)?.[2];
    if (source === undefined) {
      bindings.openApps = true;
      library.patterns.argument.lastIndex = start;
      if (library.patterns.argument.test(code)) bindings.openAll = true;
      continue;
    }
    if (source === library.name) {
      bindings.openAll = true;
      bindings.libraryImports.barrel = true;
    }
    const direct = library.patterns.directComponentPath.exec(source)?.[1];
    if (direct) {
      bindings.dynamic.push(direct);
      bindings.libraryImports.components.add(direct);
    }
    const resolved =
      app && resolveAppImport(library, app.from, source, app.apps);
    if (resolved) bindings.openAppComponents.push(...resolved.keys);
  }
}

/** JS and TS modules, which `lexImportsExports` reads. */
const SCRIPT_FILE = /\.[cm]?[jt]sx?$/;
const IMPORT_AS = /\s+as\s+/;
const SVELTE_SPECIFIER = /(["'])([^"'\n]+\.svelte)\1/g;

function providedContexts(library: Library, code: string): Set<string> {
  const keys = new Set<string>();
  if (!code.includes(library.spec.contextKeyPrefix)) return keys;
  for (const match of code.matchAll(library.patterns.contextKey))
    keys.add(match[2]);
  return keys;
}

/**
 * Whether a key the module passes `setContext` may be a library key that
 * `providedContexts` can't see: one held by the library's script modules, or
 * built from parts (`library.spec.contextKeyPrefix + name`).
 */
function providesUnknownContext(library: Library, code: string): boolean {
  if (!code.includes("setContext")) return false;
  if (library.patterns.scriptSpecifier.test(code)) return true;
  const mentions = code.split(library.spec.contextKeyPrefix).length - 1;
  return mentions > [...code.matchAll(library.patterns.contextKey)].length;
}

function readsLibraryContext(library: Library, code: string): boolean {
  if (code.includes("getAllContexts")) return true;
  return (
    code.includes("getContext") &&
    (code.includes(library.spec.contextKeyPrefix) ||
      library.patterns.scriptSpecifier.test(code))
  );
}

type ImportBindings = {
  /** Local binding -> library component key, or app component file. */
  components: Map<string, string>;
  /** Local names of `import * as C from "<library>"`. */
  namespaces: Set<string>;
  /** Bindings known to hold a component (the library's, icons, local `.svelte`). */
  objects: Set<string>;
  /** Re-exported library components: rendered somewhere we can't see. */
  reExported: string[];
  /** Library components imported with `import()` or `require()`. */
  dynamic: string[];
  /** Any library component may render: `export *`, or a dynamic barrel import. */
  openAll: boolean;
  /**
   * App components imported dynamically, re-exported, or through a path
   * that can't be resolved for sure: rendered with any props.
   */
  openAppComponents: string[];
  /** See `ModuleUsage.openApps`. */
  openApps: boolean;
  libraryImports: LibraryImports;
};

function newBindings(): ImportBindings {
  return {
    components: new Map(),
    namespaces: new Set(),
    objects: new Set(),
    reExported: [],
    dynamic: [],
    openAll: false,
    openAppComponents: [],
    openApps: false,
    libraryImports: { components: new Set(), barrel: false },
  };
}

/** Where to resolve the app's own `.svelte` imports from, if anywhere. */
type AppImports = { from: string; apps: AppComponents } | undefined;

function readImports(
  code: string,
  library: Library,
  bindings: ImportBindings,
  app: AppImports,
): void {
  if (
    !code.includes(library.name) &&
    !(app && (code.includes("import") || code.includes("export")))
  ) {
    return;
  }
  for (const statement of lexImportsExports(code)) {
    const from = statement.source?.value;
    if (!from || statement.typeOnly) continue;
    const isBarrel = from === library.name;
    const directKey = library.patterns.directComponentPath.exec(from)?.[1];
    const appImport =
      app && resolveAppImport(library, app.from, from, app.apps);
    if (isBarrel) bindings.libraryImports.barrel = true;
    if (directKey) bindings.libraryImports.components.add(directKey);

    if (statement.kind === "export") {
      for (const specifier of statement.specifiers) {
        if (specifier.typeOnly) continue;
        if (isBarrel && specifier.kind !== "named") bindings.openAll = true;
        const key = isBarrel
          ? library.components.get(specifier.local)
          : directKey;
        if (key) {
          bindings.reExported.push(key);
          bindings.libraryImports.components.add(key);
        }
      }
      if (appImport) bindings.openAppComponents.push(...appImport.keys);
      continue;
    }

    for (const specifier of statement.specifiers) {
      if (specifier.typeOnly) continue;
      if (library.patterns.componentSource.test(from))
        bindings.objects.add(specifier.local);
      if (appImport) {
        if (appImport.exact && specifier.kind === "default") {
          bindings.components.set(specifier.local, appImport.keys[0]);
        } else {
          bindings.openAppComponents.push(...appImport.keys);
        }
      } else if (isBarrel) {
        if (specifier.kind === "namespace") {
          bindings.namespaces.add(specifier.local);
        } else {
          const key = library.components.get(specifier.imported);
          if (key) {
            bindings.components.set(specifier.local, key);
            bindings.libraryImports.components.add(key);
          }
        }
      } else if (directKey && specifier.kind === "default") {
        bindings.components.set(specifier.local, directKey);
      }
    }
  }
}

function openSite(
  component: string,
  file: string,
  line: number,
  reason: string,
): CallSite {
  return {
    component,
    open: true,
    props: new Map(),
    slots: null,
    location: { file, line },
    reason,
  };
}

/**
 * Call sites in a JS/TS module (or anything else that isn't a `.svelte`
 * file): it can only use library components as values, so every one it
 * imports or re-exports is open.
 */
export function collectScriptUsage(
  code: string,
  file: string,
  library: Library,
  reason = "used from a script module",
  apps?: AppComponents,
): ModuleUsage {
  const bindings = newBindings();
  const app = apps && { from: file, apps };
  readImports(code, library, bindings, app);
  readDynamicImports(library, code, bindings, app);
  return {
    sites: [
      ...bindings.components.values(),
      ...bindings.reExported,
      ...bindings.dynamic,
      ...bindings.openAppComponents,
    ].map((key) => openSite(key, file, 1, reason)),
    openAll: bindings.namespaces.size > 0 || bindings.openAll,
    openApps: bindings.openApps,
    providedContexts: providedContexts(library, code),
    providesUnknownContext: providesUnknownContext(library, code),
    readsLibraryContext: readsLibraryContext(library, code),
    file,
    libraryImports: bindings.libraryImports,
  };
}

/**
 * Call sites in a file the analysis can't parse (Markdown, Astro, a
 * `.svelte` file another preprocessor rewrites), read from its text alone:
 * every library component it imports with `import { … }` or by path is
 * open, and any other mention of the package (a namespace import, a
 * re-export, a dynamic import) opens every component.
 */
export function collectImportedUsage(
  code: string,
  file: string,
  library: Library,
  reason: string,
  apps?: AppComponents,
): ModuleUsage {
  const bindings = newBindings();
  const usage: ModuleUsage = {
    sites: [],
    openAll: false,
    providedContexts: providedContexts(library, code),
    providesUnknownContext: providesUnknownContext(library, code),
    readsLibraryContext: readsLibraryContext(library, code),
    file,
    libraryImports: bindings.libraryImports,
  };
  readDynamicImports(library, code, bindings, apps && { from: file, apps });
  usage.openAll = bindings.openAll;
  for (const key of bindings.dynamic)
    usage.sites.push(openSite(key, file, 1, reason));
  if (apps) {
    // Every `.svelte` path it names, imported or not, renders with any props.
    usage.openApps = bindings.openApps;
    for (const match of code.matchAll(SVELTE_SPECIFIER)) {
      for (const key of resolveAppImport(library, file, match[2], apps)?.keys ??
        []) {
        usage.sites.push(
          openSite(key, file, locate(code, match.index).line, reason),
        );
      }
    }
    for (const key of bindings.openAppComponents) {
      usage.sites.push(openSite(key, file, 1, reason));
    }
  }
  if (!code.includes(library.name)) return usage;

  const understood = new Set<number>();
  for (const match of code.matchAll(library.patterns.barrelImport)) {
    understood.add(match.index + match[0].length - library.name.length - 2);
    if (match[1]) continue; // `import type { … }`
    for (const specifier of match[2].split(",")) {
      const name = specifier.trim();
      if (name === "" || name.startsWith("type ")) continue;
      const key = library.components.get(name.split(IMPORT_AS)[0]);
      if (key) {
        usage.sites.push(
          openSite(key, file, locate(code, match.index).line, reason),
        );
        bindings.libraryImports.components.add(key);
      }
    }
  }
  for (const match of code.matchAll(library.patterns.barrelSpecifier)) {
    bindings.libraryImports.barrel = true;
    if (!understood.has(match.index)) usage.openAll = true;
  }
  for (const match of code.matchAll(
    library.patterns.directComponentSpecifier,
  )) {
    usage.sites.push(
      openSite(match[1], file, locate(code, match.index).line, reason),
    );
    bindings.libraryImports.components.add(match[1]);
  }
  return usage;
}

/**
 * Call sites in an app file read from its source as written: `.svelte`
 * files are parsed, scripts lexed, and anything else read for imports.
 */
export function collectSourceUsage(
  code: string,
  file: string,
  library: Library,
  apps?: AppComponents,
): ModuleUsage {
  if (file.endsWith(".svelte")) {
    return collectSvelteUsage(code, file, library, { apps });
  }
  if (SCRIPT_FILE.test(file)) {
    return collectScriptUsage(code, file, library, undefined, apps);
  }
  return collectImportedUsage(
    code,
    file,
    library,
    "not a Svelte or script file",
    apps,
  );
}

/**
 * Evaluates prop expressions in an app component: its constants and the
 * state no code reassigns are known, its own props are not. Falls back to
 * literals alone where the component can't be modeled.
 */
function appEvaluator(
  code: string,
  ast: AST.Root,
  file: string,
  objects: Set<string>,
  options: SvelteUsageOptions,
): {
  value: (expression: Expression) => Value;
  spread: (argument: Expression) => Map<string, PassedProp> | undefined;
  explain: Explain;
  /** Binds an `{#each}`'s item while its body is read; returns the unbinding. */
  bindEach: (node: Extract<Node, { type: "EachBlock" }>) => () => void;
} {
  let scope: ReturnType<typeof createScope> | undefined;
  try {
    const model =
      options.model ?? buildComponentModel(code, file, undefined, ast);
    let usage = options.usage;
    if (!usage) {
      usage = newComponentUsage();
      usage.open = true;
    }
    scope = appScope(model, file, usage, options.constants);
  } catch {
    scope = undefined;
  }
  return {
    value: (expression) => {
      // A component passed as a prop (`icon={Add}`) is an object.
      if (expression.type === "Identifier" && objects.has(expression.name)) {
        return possible(OBJECT);
      }
      return scope
        ? evaluate(expression, scope)
        : staticValue(expression, objects);
    },
    // A wrapper's `{...$$restProps}`: what its own call sites pass.
    spread: (argument) => (scope ? spreadProps(argument, scope) : undefined),
    explain: (expression) =>
      scope ? whyUnknownLater(expression, scope) : () => "isn't a literal",
    bindEach: (node) => (scope ? bindEach(node, scope) : () => {}),
  };
}

/**
 * The scope app component `file` evaluates in under `usage`: the
 * constants it imports from the app's modules are known, its context
 * isn't.
 */
export function appScope(
  model: ComponentModel,
  file: string,
  usage: ComponentUsage,
  constants: ModuleConstants | undefined,
): Scope {
  return createScope(
    model,
    usage,
    () => UNKNOWN,
    importedConstants(model, file, constants),
  );
}

const MODULE_EXTENSIONS = [
  "",
  ".ts",
  ".js",
  ".mts",
  ".mjs",
  "/index.ts",
  "/index.js",
];

/** The values `model` imports by name from the app's own modules. */
function importedConstants(
  model: ComponentModel,
  file: string,
  constants: ModuleConstants | undefined,
): Map<string, Value> {
  const values = new Map<string, Value>();
  if (!constants) return values;
  for (const script of [model.ast.module, model.ast.instance]) {
    for (const statement of (script?.content.body ?? []) as Node[]) {
      if (statement.type !== "ImportDeclaration") continue;
      const source = String(statement.source.value);
      if (!source.startsWith(".")) continue;
      const base = path.resolve(path.dirname(file), source);
      const exports = MODULE_EXTENSIONS.map((ext) =>
        constants(base + ext),
      ).find(Boolean);
      if (!exports) continue;
      for (const specifier of statement.specifiers) {
        if (
          specifier.type !== "ImportSpecifier" ||
          specifier.imported.type !== "Identifier"
        ) {
          continue;
        }
        const value = exports.get(specifier.imported.name);
        if (value) values.set(specifier.local.name, value);
      }
    }
  }
  return values;
}

/** What `collectSvelteUsage` needs to follow props through app components. */
export type SvelteUsageOptions = {
  /** The app's `.svelte` files: sites of these are collected too. */
  apps?: AppComponents;
  /** How this component is rendered; by default, with any props. */
  usage?: ComponentUsage;
  /** This component's model, if already built. */
  model?: ComponentModel;
  /** Exported constants of the app's own modules. */
  constants?: ModuleConstants;
};

/** The constants app module `file` exports, by name; `undefined` if none. */
export type ModuleConstants = (
  file: string,
) => ReadonlyMap<string, Value> | undefined;

const BLANK = /^\s*$/;

/**
 * Svelte 5 passes an element's content as props: its `{#snippet name()}`
 * blocks by name, and anything else as `children`.
 */
function passSnippets(
  node: AST.Component | AST.SvelteSelf,
  site: CallSite,
): void {
  for (const child of node.fragment.nodes) {
    if (child.type === "Comment") continue;
    if (child.type === "Text" && BLANK.test(child.data)) continue;
    if (child.type === "SnippetBlock") {
      site.props.set(child.expression.name, possible(OBJECT));
    } else {
      site.props.set("children", possible(OBJECT));
    }
  }
}

/** A prop value the app writes literally; anything else is unknown. */
function staticValue(expression: Expression, objects: Set<string>): Value {
  switch (expression.type) {
    case "Literal":
      if ("regex" in expression && expression.regex) return possible(OBJECT);
      return typeof expression.value === "bigint"
        ? UNKNOWN
        : possible(expression.value as string | number | boolean | null);
    case "TemplateLiteral":
      return expression.expressions.length === 0
        ? possible(expression.quasis[0].value.cooked ?? "")
        : UNKNOWN;
    case "Identifier":
      if (expression.name === "undefined") return UNDEFINED;
      return objects.has(expression.name) ? possible(OBJECT) : UNKNOWN;
    case "ArrayExpression":
      return possible(expression.elements.length === 0 ? EMPTY_ARRAY : OBJECT);
    case "ObjectExpression":
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return possible(OBJECT);
    default:
      return UNKNOWN;
  }
}

/**
 * Call sites of library components in an app `.svelte` file, read from its
 * source as written (barrel or direct-path imports).
 *
 * Sound by construction: a component referenced as a value, spread into, or
 * imported but never rendered as a tag (markup another preprocessor
 * generates) is open; a file that doesn't parse makes every library
 * component it imports open.
 */
export function collectSvelteUsage(
  code: string,
  file: string,
  library: Library,
  options: SvelteUsageOptions = {},
): ModuleUsage {
  const { apps } = options;
  // With the app's components, every file is walked: one can render
  // another, or itself, in ways no text check can rule out.
  if (!apps && !code.includes(library.name)) {
    return { sites: [], openAll: false, providedContexts: new Set(), file };
  }

  let ast: AST.Root;
  try {
    // The model, if given, holds the same parse.
    ast = options.model?.ast ?? parse(code, { comments: false });
  } catch {
    return collectImportedUsage(
      code,
      file,
      library,
      "could not be parsed",
      apps,
    );
  }

  const bindings = newBindings();
  const app = apps && { from: file, apps };
  for (const script of [ast.module, ast.instance]) {
    if (script) {
      readImports(
        code.slice(script.content.start, script.content.end),
        library,
        bindings,
        app,
      );
    }
  }
  // The markup too: `{#await import("…")}`.
  readDynamicImports(library, code, bindings, app);

  const usage: ModuleUsage = {
    sites: [
      ...bindings.reExported.map((key) =>
        openSite(key, file, 1, "re-exported"),
      ),
      ...bindings.dynamic.map((key) =>
        openSite(key, file, 1, "imported dynamically"),
      ),
      ...bindings.openAppComponents.map((key) =>
        openSite(key, file, 1, "imported dynamically or through an alias"),
      ),
    ],
    openAll: bindings.openAll,
    openApps: bindings.openApps,
    providedContexts: providedContexts(library, code),
    providesUnknownContext: providesUnknownContext(library, code),
    readsLibraryContext: readsLibraryContext(library, code),
    file,
    libraryImports: bindings.libraryImports,
  };
  const rendered = new Set<string>();
  const line = (node: { start: number }) => locate(code, node.start).line;
  const props = appEvaluator(code, ast, file, bindings.objects, options);
  const explainAt =
    (node: { start: number }): Explain =>
    (expression) => {
      const why = props.explain(expression);
      return () => {
        const reason = why();
        return reason && `${path.basename(file)}:${line(node)} ${reason}`;
      };
    };

  /** Marks the components a branch that can't render names, without sites. */
  const markRendered = (node: Node | null | undefined): void => {
    if (!node) return;
    forEachNode(node, (inner) => {
      if (inner.type === "Component") rendered.add(inner.name.split(".")[0]);
      if (
        inner.type === "Identifier" &&
        (bindings.components.has(inner.name) ||
          bindings.namespaces.has(inner.name))
      ) {
        rendered.add(inner.name);
      }
    });
  };

  const visit = (node: Node, parent: Node | null): void => {
    switch (node.type) {
      case "ImportDeclaration":
        return;

      // A branch that can't render passes nothing to what it holds.
      case "IfBlock": {
        visit(node.test, node);
        const truth = truthOf(props.value(node.test));
        if (truth === "falsy") markRendered(node.consequent as Node);
        else visit(node.consequent as Node, node);
        if (node.alternate) {
          if (truth === "truthy") markRendered(node.alternate as Node);
          else visit(node.alternate as Node, node);
        }
        return;
      }

      case "EachBlock": {
        visit(node.expression, node);
        if (isEmptyArray(props.value(node.expression))) {
          markRendered(node.body as Node);
        } else {
          const unbind = props.bindEach(node);
          try {
            if (node.key) visit(node.key as Node, node);
            visit(node.body as Node, node);
          } finally {
            unbind();
          }
        }
        if (node.fallback) visit(node.fallback as Node, node);
        return;
      }

      case "Component": {
        const [namespace, member] = node.name.split(".");
        const key = member
          ? bindings.namespaces.has(namespace)
            ? library.components.get(member)
            : undefined
          : bindings.components.get(node.name);
        if (key) {
          rendered.add(member ? namespace : node.name);
          const site = callSiteFromElement(
            node,
            key,
            props.value,
            props.spread,
            explainAt(node),
          );
          if (isAppComponent(key)) passSnippets(node, site);
          site.location = { file, line: line(node) };
          usage.sites.push(site);
        }
        break;
      }

      case "SvelteSelf":
        if (apps) {
          const site = callSiteFromElement(
            node,
            file,
            props.value,
            props.spread,
            explainAt(node),
          );
          passSnippets(node, site);
          site.location = { file, line: line(node) };
          usage.sites.push(site);
        }
        break;

      case "Identifier": {
        const key = bindings.components.get(node.name);
        if (key) {
          rendered.add(node.name);
          usage.sites.push(openSite(key, file, line(node), "used as a value"));
        } else if (bindings.namespaces.has(node.name)) {
          rendered.add(node.name);
          const member =
            parent?.type === "MemberExpression" &&
            parent.object === node &&
            !parent.computed &&
            parent.property.type === "Identifier"
              ? library.components.get(parent.property.name)
              : undefined;
          if (member) {
            usage.sites.push(
              openSite(member, file, line(node), "used as a value"),
            );
          } else {
            usage.openAll = true;
          }
        }
        return;
      }
    }
    for (const child of children(node)) visit(child, node);
  };

  for (const node of [ast.module, ast.instance, ast.fragment]) {
    if (node) visit(node, null);
  }

  for (const namespace of bindings.namespaces) {
    if (!rendered.has(namespace)) usage.openAll = true;
  }
  for (const [local, key] of bindings.components) {
    if (!rendered.has(local)) {
      usage.sites.push(
        openSite(
          key,
          file,
          1,
          `${local} is imported but not rendered as a tag`,
        ),
      );
    }
  }

  return usage;
}
