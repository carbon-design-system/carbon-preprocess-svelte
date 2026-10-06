import path from "node:path";
import { lexImportsExports } from "sveast/lexer";
import type { AST, Expression } from "sveast/walk";
import { CarbonSvelte } from "../constants";
import { readCarbonExports } from "../indexer/carbon-exports";
import { parse } from "../indexer/parser";
import { childNodes, lineAt, type Node } from "./ast";
import { buildComponentModel, type ComponentModel } from "./component-model";
import { createScope, evaluate } from "./evaluate";
import { callSiteFromElement } from "./live-walk";
import { type CallSite, type ComponentUsage, newComponentUsage } from "./usage";
import {
  EMPTY_ARRAY,
  OBJECT,
  possible,
  UNDEFINED,
  UNKNOWN,
  type Value,
} from "./values";

/** Carbon component export name -> module key (`Button` -> `Button/Button.svelte`). */
export type CarbonComponents = Map<string, string>;

const SRC_PREFIX = `${CarbonSvelte.Components}/src/`;

export function readCarbonComponents(carbonRoot: string): CarbonComponents {
  const components: CarbonComponents = new Map();
  for (const [name, target] of readCarbonExports(carbonRoot)) {
    if (target.name === "default" && target.path.endsWith(".svelte")) {
      components.set(name, target.path.slice(SRC_PREFIX.length));
    }
  }
  return components;
}

/** What one app module contributes to the analysis. */
export type ModuleUsage = {
  /**
   * Its call sites: of Carbon components (keyed like `Button/Button.svelte`)
   * and, when `AppComponents` are given, of the app's own `.svelte` files
   * (keyed by absolute path).
   */
  sites: CallSite[];
  /** Every bundled Carbon component may render with any props. */
  openAll: boolean;
  /**
   * It imports `.svelte` files in a way the analysis can't follow (a
   * computed `import()`, `import.meta.glob`): every app component may
   * render with any props.
   */
  openApps?: boolean;
  /** `carbon:` context keys the module passes to `setContext`. */
  providedContexts: Set<string>;
};

/** The app's own `.svelte` files the analysis reads, for resolving imports of them. */
export type AppComponents = {
  files: ReadonlySet<string>;
  /** File name -> files, for imports through an alias (`$lib/X.svelte`). */
  byName: ReadonlyMap<string, string[]>;
};

export function indexAppComponents(files: Iterable<string>): AppComponents {
  const byName = new Map<string, string[]>();
  const set = new Set<string>();
  for (const file of files) {
    set.add(file);
    const name = path.basename(file);
    byName.set(name, [...(byName.get(name) ?? []), file]);
  }
  return { files: set, byName };
}

/** Whether `key` names an app component (an absolute path), not a Carbon one. */
export function isAppComponent(key: string): boolean {
  return path.isAbsolute(key);
}

/**
 * The app components `source`, imported from `from`, can be: exactly one
 * for a relative path to a known file; every file of the same name for an
 * alias or package path (`$lib/Card.svelte`), which can't be told apart.
 */
function resolveAppImport(
  from: string,
  source: string,
  apps: AppComponents,
): { keys: string[]; exact: boolean } | undefined {
  if (source.startsWith(".")) {
    const file = path.resolve(path.dirname(from), source);
    return apps.files.has(file) ? { keys: [file], exact: true } : undefined;
  }
  if (!source.endsWith(".svelte") || source.startsWith(SRC_PREFIX)) {
    return undefined;
  }
  const keys = apps.byName.get(path.posix.basename(source));
  return keys ? { keys, exact: false } : undefined;
}

const DYNAMIC_IMPORT = /\bimport\s*\(/g;
const LITERAL_IMPORT = /^\s*(["'`])([^"'`$]+)\1\s*\)/;
const IMPORT_META_GLOB = /\bimport\.meta\.glob\b/;

/**
 * `import()` and `import.meta.glob` in `code`: a literal `import()` of an
 * app component renders it with any props; anything else might.
 */
function readDynamicImports(
  code: string,
  from: string,
  apps: AppComponents,
  bindings: ImportBindings,
): void {
  if (IMPORT_META_GLOB.test(code)) bindings.openApps = true;
  for (const match of code.matchAll(DYNAMIC_IMPORT)) {
    const literal = LITERAL_IMPORT.exec(
      code.slice(match.index + match[0].length),
    );
    if (!literal) {
      bindings.openApps = true;
      continue;
    }
    const resolved = resolveAppImport(from, literal[2], apps);
    if (resolved) bindings.openAppComponents.push(...resolved.keys);
  }
}

const DIRECT_COMPONENT_PATH = /^carbon-components-svelte\/src\/(.+\.svelte)$/;
const PROVIDED_CONTEXT = /setContext\(\s*["'](carbon:[^"']+)["']/g;
/** JS and TS modules, which `lexImportsExports` reads. */
const SCRIPT_FILE = /\.[cm]?[jt]sx?$/;
const BARREL_IMPORT =
  /\bimport\s+(type\s+)?\{([^}]*)\}\s*from\s*(["'])carbon-components-svelte\3/g;
const BARREL_SPECIFIER = /["']carbon-components-svelte["']/g;
const DIRECT_COMPONENT_SPECIFIER =
  /["']carbon-components-svelte\/src\/([^"']+\.svelte)["']/g;
const IMPORT_AS = /\s+as\s+/;
const SVELTE_SPECIFIER = /(["'])([^"'\n]+\.svelte)\1/g;
/** Imports that are components, so passing one as a prop passes an object. */
const COMPONENT_SOURCE = /\.svelte$|^carbon-(icons|pictograms)-svelte(\/|$)/;

function providedContexts(code: string): Set<string> {
  const keys = new Set<string>();
  for (const match of code.matchAll(PROVIDED_CONTEXT)) keys.add(match[1]);
  return keys;
}

type ImportBindings = {
  /** Local binding -> Carbon component key, or app component file. */
  components: Map<string, string>;
  /** Local names of `import * as C from "carbon-components-svelte"`. */
  namespaces: Set<string>;
  /** Bindings known to hold a component (Carbon, icons, local `.svelte`). */
  objects: Set<string>;
  /** Re-exported Carbon components: rendered somewhere we can't see. */
  reExported: string[];
  reExportsAll: boolean;
  /**
   * App components imported dynamically, re-exported, or through a path
   * that can't be resolved for sure: rendered with any props.
   */
  openAppComponents: string[];
  /** See `ModuleUsage.openApps`. */
  openApps: boolean;
};

function newBindings(): ImportBindings {
  return {
    components: new Map(),
    namespaces: new Set(),
    objects: new Set(),
    reExported: [],
    reExportsAll: false,
    openAppComponents: [],
    openApps: false,
  };
}

/** Where to resolve the app's own `.svelte` imports from, if anywhere. */
type AppImports = { from: string; apps: AppComponents } | undefined;

function readImports(
  code: string,
  carbon: CarbonComponents,
  bindings: ImportBindings,
  app: AppImports,
): void {
  if (app) readDynamicImports(code, app.from, app.apps, bindings);
  if (!code.includes(CarbonSvelte.Components) && !code.includes(".svelte")) {
    return;
  }
  for (const statement of lexImportsExports(code)) {
    const from = statement.source?.value;
    if (!from || statement.typeOnly) continue;
    const isBarrel = from === CarbonSvelte.Components;
    const directKey = DIRECT_COMPONENT_PATH.exec(from)?.[1];
    const appImport = app && resolveAppImport(app.from, from, app.apps);

    if (statement.kind === "export") {
      for (const specifier of statement.specifiers) {
        if (specifier.typeOnly) continue;
        if (isBarrel && specifier.kind !== "named")
          bindings.reExportsAll = true;
        const key = isBarrel ? carbon.get(specifier.local) : directKey;
        if (key) bindings.reExported.push(key);
      }
      if (appImport) bindings.openAppComponents.push(...appImport.keys);
      continue;
    }

    for (const specifier of statement.specifiers) {
      if (specifier.typeOnly) continue;
      if (COMPONENT_SOURCE.test(from)) bindings.objects.add(specifier.local);
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
          const key = carbon.get(specifier.imported);
          if (key) bindings.components.set(specifier.local, key);
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
 * file): it can only use Carbon components as values, so every one it
 * imports or re-exports is open.
 */
export function collectScriptUsage(
  code: string,
  file: string,
  carbon: CarbonComponents,
  reason = "used from a script module",
  apps?: AppComponents,
): ModuleUsage {
  const bindings = newBindings();
  readImports(code, carbon, bindings, apps && { from: file, apps });
  return {
    sites: [
      ...bindings.components.values(),
      ...bindings.reExported,
      ...bindings.openAppComponents,
    ].map((key) => openSite(key, file, 1, reason)),
    openAll: bindings.namespaces.size > 0 || bindings.reExportsAll,
    openApps: bindings.openApps,
    providedContexts: providedContexts(code),
  };
}

/**
 * Call sites in a file the analysis can't parse (Markdown, Astro, a
 * `.svelte` file another preprocessor rewrites), read from its text alone:
 * every Carbon component it imports with `import { … }` or by path is
 * open, and any other mention of the package (a namespace import, a
 * re-export, a dynamic import) opens every component.
 */
export function collectImportedUsage(
  code: string,
  file: string,
  carbon: CarbonComponents,
  reason: string,
  apps?: AppComponents,
): ModuleUsage {
  const usage: ModuleUsage = {
    sites: [],
    openAll: false,
    providedContexts: providedContexts(code),
  };
  if (apps) {
    // Every `.svelte` path it names, imported or not, renders with any props.
    const bindings = newBindings();
    readDynamicImports(code, file, apps, bindings);
    usage.openApps = bindings.openApps;
    for (const match of code.matchAll(SVELTE_SPECIFIER)) {
      for (const key of resolveAppImport(file, match[2], apps)?.keys ?? []) {
        usage.sites.push(
          openSite(key, file, lineAt(code, match.index), reason),
        );
      }
    }
    for (const key of bindings.openAppComponents) {
      usage.sites.push(openSite(key, file, 1, reason));
    }
  }
  if (!code.includes(CarbonSvelte.Components)) return usage;

  const understood = new Set<number>();
  for (const match of code.matchAll(BARREL_IMPORT)) {
    understood.add(
      match.index + match[0].length - CarbonSvelte.Components.length - 2,
    );
    if (match[1]) continue; // `import type { … }`
    for (const specifier of match[2].split(",")) {
      const name = specifier.trim();
      if (name === "" || name.startsWith("type ")) continue;
      const key = carbon.get(name.split(IMPORT_AS)[0]);
      if (key)
        usage.sites.push(
          openSite(key, file, lineAt(code, match.index), reason),
        );
    }
  }
  for (const match of code.matchAll(BARREL_SPECIFIER)) {
    if (!understood.has(match.index)) usage.openAll = true;
  }
  for (const match of code.matchAll(DIRECT_COMPONENT_SPECIFIER)) {
    usage.sites.push(
      openSite(match[1], file, lineAt(code, match.index), reason),
    );
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
  carbon: CarbonComponents,
  apps?: AppComponents,
): ModuleUsage {
  if (file.endsWith(".svelte")) {
    return collectSvelteUsage(code, file, carbon, { apps });
  }
  if (SCRIPT_FILE.test(file)) {
    return collectScriptUsage(code, file, carbon, undefined, apps);
  }
  return collectImportedUsage(
    code,
    file,
    carbon,
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
  file: string,
  objects: Set<string>,
  options: SvelteUsageOptions,
): (expression: Expression) => Value {
  let scope: ReturnType<typeof createScope> | undefined;
  try {
    const model = options.model ?? buildComponentModel(code, file);
    let usage = options.usage;
    if (!usage) {
      usage = newComponentUsage();
      usage.open = true;
    }
    scope = createScope(model, usage, () => UNKNOWN);
  } catch {
    scope = undefined;
  }
  return (expression) => {
    // A component passed as a prop (`icon={Add}`) is an object.
    if (expression.type === "Identifier" && objects.has(expression.name)) {
      return possible(OBJECT);
    }
    return scope
      ? evaluate(expression, scope)
      : staticValue(expression, objects);
  };
}

/** What `collectSvelteUsage` needs to follow props through app components. */
export type SvelteUsageOptions = {
  /** The app's `.svelte` files: sites of these are collected too. */
  apps?: AppComponents;
  /** How this component is rendered; by default, with any props. */
  usage?: ComponentUsage;
  /** This component's model, if already built. */
  model?: ComponentModel;
};

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
 * Call sites of Carbon components in an app `.svelte` file, read from its
 * source as written (barrel or direct-path imports).
 *
 * Sound by construction: a component referenced as a value, spread into, or
 * imported but never rendered as a tag (markup another preprocessor
 * generates) is open; a file that doesn't parse makes every Carbon
 * component it imports open.
 */
export function collectSvelteUsage(
  code: string,
  file: string,
  carbon: CarbonComponents,
  options: SvelteUsageOptions = {},
): ModuleUsage {
  const { apps } = options;
  if (
    !code.includes(CarbonSvelte.Components) &&
    !(apps && (code.includes(".svelte") || code.includes("import")))
  ) {
    return { sites: [], openAll: false, providedContexts: new Set() };
  }

  let ast: AST.Root;
  try {
    ast = parse(code, { comments: false });
  } catch {
    return collectImportedUsage(
      code,
      file,
      carbon,
      "could not be parsed",
      apps,
    );
  }

  const bindings = newBindings();
  for (const script of [ast.module, ast.instance]) {
    if (script) {
      readImports(
        code.slice(script.content.start, script.content.end),
        carbon,
        bindings,
        apps && { from: file, apps },
      );
    }
  }

  const usage: ModuleUsage = {
    sites: [
      ...bindings.reExported.map((key) =>
        openSite(key, file, 1, "re-exported"),
      ),
      ...bindings.openAppComponents.map((key) =>
        openSite(key, file, 1, "imported dynamically or through an alias"),
      ),
    ],
    openAll: bindings.reExportsAll,
    openApps: bindings.openApps,
    providedContexts: providedContexts(code),
  };
  const rendered = new Set<string>();
  const line = (node: { start: number }) => lineAt(code, node.start);
  const propValue = appEvaluator(code, file, bindings.objects, options);

  const visit = (node: Node, parent: Node | null): void => {
    switch (node.type) {
      case "ImportDeclaration":
        return;

      case "Component": {
        const [namespace, member] = node.name.split(".");
        const key = member
          ? bindings.namespaces.has(namespace)
            ? carbon.get(member)
            : undefined
          : bindings.components.get(node.name);
        if (key) {
          rendered.add(member ? namespace : node.name);
          const site = callSiteFromElement(node, key, propValue);
          if (isAppComponent(key)) passSnippets(node, site);
          site.location = { file, line: line(node) };
          usage.sites.push(site);
        }
        break;
      }

      case "SvelteSelf":
        if (apps) {
          const site = callSiteFromElement(node, file, propValue);
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
              ? carbon.get(parent.property.name)
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
    for (const child of childNodes(node)) visit(child, node);
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
