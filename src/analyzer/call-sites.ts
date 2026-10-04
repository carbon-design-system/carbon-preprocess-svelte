import { lexImportsExports } from "sveast/lexer";
import type { AST, Expression } from "sveast/walk";
import { CarbonSvelte } from "../constants";
import { readCarbonExports } from "../indexer/carbon-exports";
import { parse } from "../indexer/parser";
import { childNodes, lineAt, type Node } from "./ast";
import { callSiteFromElement } from "./live-walk";
import type { CallSite } from "./usage";
import { OBJECT, possible, UNDEFINED, UNKNOWN, type Value } from "./values";

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
  sites: CallSite[];
  /** Every bundled Carbon component may render with any props. */
  openAll: boolean;
  /** `carbon:` context keys the module passes to `setContext`. */
  providedContexts: Set<string>;
};

const DIRECT_COMPONENT_PATH = /^carbon-components-svelte\/src\/(.+\.svelte)$/;
const PROVIDED_CONTEXT = /setContext\(\s*["'](carbon:[^"']+)["']/g;
/** Imports that are components, so passing one as a prop passes an object. */
const COMPONENT_SOURCE = /\.svelte$|^carbon-(icons|pictograms)-svelte(\/|$)/;

function providedContexts(code: string): Set<string> {
  const keys = new Set<string>();
  for (const match of code.matchAll(PROVIDED_CONTEXT)) keys.add(match[1]);
  return keys;
}

type ImportBindings = {
  /** Local binding -> Carbon component key. */
  components: Map<string, string>;
  /** Local names of `import * as C from "carbon-components-svelte"`. */
  namespaces: Set<string>;
  /** Bindings known to hold a component (Carbon, icons, local `.svelte`). */
  objects: Set<string>;
  /** Re-exported Carbon components: rendered somewhere we can't see. */
  reExported: string[];
  reExportsAll: boolean;
};

function readImports(
  code: string,
  carbon: CarbonComponents,
  bindings: ImportBindings,
): void {
  if (!code.includes(CarbonSvelte.Components) && !code.includes(".svelte")) {
    return;
  }
  for (const statement of lexImportsExports(code)) {
    const from = statement.source?.value;
    if (!from || statement.typeOnly) continue;
    const isBarrel = from === CarbonSvelte.Components;
    const directKey = DIRECT_COMPONENT_PATH.exec(from)?.[1];

    if (statement.kind === "export") {
      for (const specifier of statement.specifiers) {
        if (specifier.typeOnly) continue;
        if (isBarrel && specifier.kind !== "named")
          bindings.reExportsAll = true;
        const key = isBarrel ? carbon.get(specifier.local) : directKey;
        if (key) bindings.reExported.push(key);
      }
      continue;
    }

    for (const specifier of statement.specifiers) {
      if (specifier.typeOnly) continue;
      if (COMPONENT_SOURCE.test(from)) bindings.objects.add(specifier.local);
      if (isBarrel) {
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
): ModuleUsage {
  const bindings: ImportBindings = {
    components: new Map(),
    namespaces: new Set(),
    objects: new Set(),
    reExported: [],
    reExportsAll: false,
  };
  readImports(code, carbon, bindings);
  return {
    sites: [...bindings.components.values(), ...bindings.reExported].map(
      (key) => openSite(key, file, 1, reason),
    ),
    openAll: bindings.namespaces.size > 0 || bindings.reExportsAll,
    providedContexts: providedContexts(code),
  };
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
): ModuleUsage {
  if (!code.includes(CarbonSvelte.Components)) {
    return { sites: [], openAll: false, providedContexts: new Set() };
  }

  let ast: AST.Root;
  try {
    ast = parse(code, { comments: false });
  } catch {
    return collectScriptUsage(code, file, carbon, "could not be parsed");
  }

  const bindings: ImportBindings = {
    components: new Map(),
    namespaces: new Set(),
    objects: new Set(),
    reExported: [],
    reExportsAll: false,
  };
  for (const script of [ast.module, ast.instance]) {
    if (script) {
      readImports(
        code.slice(script.content.start, script.content.end),
        carbon,
        bindings,
      );
    }
  }

  const usage: ModuleUsage = {
    sites: bindings.reExported.map((key) =>
      openSite(key, file, 1, "re-exported"),
    ),
    openAll: bindings.reExportsAll,
    providedContexts: providedContexts(code),
  };
  const rendered = new Set<string>();
  const line = (node: { start: number }) => lineAt(code, node.start);

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
          const site = callSiteFromElement(node, key, (expression) =>
            staticValue(expression, bindings.objects),
          );
          site.location = { file, line: line(node) };
          usage.sites.push(site);
        }
        break;
      }

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
