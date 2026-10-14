import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { lexComponent, lexImportsExports } from "sveast/lexer";
import { extractIdentifiers, type Pattern } from "sveast/walk";
import { forEachNode, type Node } from "./ast";
import { parse } from "./parser";

/** Where a name a package's barrel exports is defined. */
export type PackageExport = {
  /** Direct import path, e.g. `some-library/src/Button/Button.svelte`. */
  path: string;
  /** Binding to import from `path`: `"default"` or a named export. */
  name: string;
};

type ReExport = { local: string; source: string };

const IDENTIFIER_NAME = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*$/u;

/** Whether `name` can be written unquoted in an import or export specifier. */
export function isIdentifierName(name: string): boolean {
  return IDENTIFIER_NAME.test(name);
}

/** Hops from the barrel to a definition before giving up, against cycles. */
const MAX_HOPS = 8;

/** `export { a, b as c } from "./x"` statements in `file`, by exported name. */
function readReExports(file: string): Map<string, ReExport> {
  const reExports = new Map<string, ReExport>();

  for (const statement of lexImportsExports(readFileSync(file, "utf8"))) {
    if (statement.kind !== "export" || !statement.source) continue;
    for (const { kind, local, exported } of statement.specifiers) {
      if (
        kind === "named" &&
        exported !== null &&
        isIdentifierName(local) &&
        isIdentifierName(exported)
      ) {
        reExports.set(exported, {
          local,
          source: statement.source.value,
        });
      }
    }
  }

  return reExports;
}

function isFile(file: string): boolean {
  return statSync(file, { throwIfNoEntry: false })?.isFile() === true;
}

/** Node-style resolution of a relative specifier. */
function resolveModule(from: string, source: string): string | undefined {
  const base = path.resolve(path.dirname(from), source);
  return [
    base,
    `${base}.js`,
    `${base}.svelte`,
    path.join(base, "index.js"),
  ].find(isFile);
}

/**
 * Maps every name package `name` at `root` exports from its barrel
 * (`srcDir/barrel`) to the module that defines it, following re-export
 * chains through a folder's `index.js` (`export { Button } from
 * "./Button"`) to the `.svelte` file.
 */
export function readPackageExports(
  root: string,
  {
    name: packageName,
    srcDir,
    barrel: barrelFile,
  }: { name: string; srcDir: string; barrel: string },
): Map<string, PackageExport> {
  const src = path.join(root, srcDir);
  const barrel = path.join(src, barrelFile);
  const reExportsByFile = new Map<string, Map<string, ReExport>>();

  function reExportsOf(file: string): Map<string, ReExport> {
    let reExports = reExportsByFile.get(file);
    if (!reExports) {
      reExports = readReExports(file);
      reExportsByFile.set(file, reExports);
    }
    return reExports;
  }

  const exports = new Map<string, PackageExport>();

  for (const [exported, reExport] of reExportsOf(barrel)) {
    let file = resolveModule(barrel, reExport.source);
    let name = reExport.local;

    for (let hop = 0; file && hop < MAX_HOPS; hop++) {
      // A default export, or any `.svelte` module, is the definition.
      if (name === "default" || !file.endsWith(".js")) break;
      const next = reExportsOf(file).get(name);
      if (!next) break;
      const target = resolveModule(file, next.source);
      if (!target) break;
      file = target;
      name = next.local;
    }

    if (!file) continue;

    exports.set(exported, {
      path: `${packageName}/${srcDir}/${path.relative(src, file).split(path.sep).join("/")}`,
      name,
    });
  }

  return exports;
}

/** What a name a library module exports is, to what renders it. */
export type Export =
  /** A component: its module key (`button/button.svelte`). */
  | { kind: "component"; key: string }
  /**
   * An object with members, each an `Export`: a namespace, or a component
   * with members (`Object.assign(Root, { Item })`), whose own module key
   * is `self`.
   */
  | { kind: "members"; self?: string; member: (name: string) => Export }
  /** Something that holds none of the library's components. */
  | { kind: "value" }
  /** Anything, a component or something that holds one included. */
  | { kind: "unknown" };

export const VALUE: Export = { kind: "value" };
export const UNKNOWN_EXPORT: Export = { kind: "unknown" };

type ModuleInfo = {
  /** `export { local as name } from "source"`, by name. */
  reExports: Map<string, { source: string; local: string }>;
  /** `export * as name from "source"`, by name. */
  namespaces: Map<string, string>;
  /** `export * from "source"`. */
  stars: string[];
  /** Import bindings, by local name; `imported` is `"*"` for a namespace. */
  imports: Map<string, { source: string; imported: string }>;
  /** A statement the lexer couldn't read. */
  unread: boolean;
  /** Its own top-level statements, parsed when first asked. */
  body: () => Node[] | undefined;
  code: string;
};

/**
 * Resolves what the modules under `src` (a library's `srcDir`) export,
 * one name at a time, following re-exports, `export *`, namespaces and
 * the bindings a module exports. A component is a `.svelte` file's
 * default export; an object of components (`{ Root }`,
 * `Object.assign(Root, { Item })`) or a namespace has members. A name
 * defined some other way holds no component only if its module can't
 * reach a `.svelte` file through its imports.
 */
export function createExportResolver(
  src: string,
): (module: string, name: string) => Export {
  const infos = new Map<string, ModuleInfo | null>();
  const resolved = new Map<string, Export | null>();
  const reaching = new Map<string, boolean>();

  const keyOf = (file: string) =>
    path.relative(src, file).split(path.sep).join("/");

  function info(key: string): ModuleInfo | null {
    if (infos.has(key)) return infos.get(key) ?? null;
    let result: ModuleInfo | null = null;
    try {
      const code = readFileSync(path.join(src, key), "utf8");
      if (key.endsWith(".svelte")) {
        // A component's named exports are its `<script module>`'s.
        const { module, typescript } = lexComponent(code);
        result = readModule(
          module ? code.slice(module.content.start, module.content.end) : "",
          typescript,
        );
      } else {
        result = readModule(code, key.endsWith(".ts"));
      }
    } catch {
      result = null;
    }
    infos.set(key, result);
    return result;
  }

  /** The module key `source` names from module `from`; `undefined` if it isn't in `src`. */
  function target(from: string, source: string): string | undefined {
    const file = resolveModule(path.join(src, from), source);
    if (!file) return undefined;
    const key = keyOf(file);
    return key.startsWith("..") ? undefined : key;
  }

  /** Whether module `key` imports a `.svelte` file, directly or through others. */
  function reachesComponents(key: string): boolean {
    const known = reaching.get(key);
    if (known !== undefined) return known;
    const seen = new Set<string>();
    const stack = [key];
    let reaches = false;
    while (stack.length > 0 && !reaches) {
      const current = stack.pop() as string;
      if (seen.has(current)) continue;
      seen.add(current);
      if (current.endsWith(".svelte")) {
        reaches = true;
        break;
      }
      const module = info(current);
      if (!module || module.unread) {
        reaches = true;
        break;
      }
      const sources = [
        ...[...module.imports.values()].map(({ source }) => source),
        ...[...module.reExports.values()].map(({ source }) => source),
        ...module.namespaces.values(),
        ...module.stars,
      ];
      for (const source of sources) {
        if (!source.startsWith(".")) continue;
        const next = target(current, source);
        if (next === undefined) {
          reaches = true;
          break;
        }
        stack.push(next);
      }
    }
    reaching.set(key, reaches);
    return reaches;
  }

  function namespaceOf(key: string): Export {
    return {
      kind: "members",
      member: (name) => resolve(key, name) ?? VALUE,
    };
  }

  /** What an import of `imported` from `source` in module `from` binds. */
  function imported(from: string, source: string, name: string): Export {
    // Another package's: none of this library's components.
    if (!source.startsWith(".")) return VALUE;
    const key = target(from, source);
    if (key === undefined) return UNKNOWN_EXPORT;
    if (name === "*") return namespaceOf(key);
    return resolve(key, name) ?? VALUE;
  }

  /** Export `name` of module `key`; `null` when it doesn't export it. */
  function resolve(key: string, name: string): Export | null {
    const id = `${key}\0${name}`;
    if (resolved.has(id)) return resolved.get(id) ?? null;
    // A cycle: whatever it is, it's unknown while being resolved.
    resolved.set(id, UNKNOWN_EXPORT);
    const result = resolveUncached(key, name);
    resolved.set(id, result);
    return result;
  }

  function resolveUncached(key: string, name: string): Export | null {
    if (key.endsWith(".svelte") && name === "default") {
      return { kind: "component", key };
    }
    const module = info(key);
    if (!module || module.unread) return UNKNOWN_EXPORT;
    const reExport = module.reExports.get(name);
    if (reExport) return imported(key, reExport.source, reExport.local);
    const namespace = module.namespaces.get(name);
    if (namespace !== undefined) return imported(key, namespace, "*");
    const local = localExport(key, module, name);
    if (local !== null) return local;
    if (name === "default") return null;
    // Another package's `export *` exports none of this library's components.
    const targets = new Set<string | undefined>();
    for (const source of module.stars) {
      if (source.startsWith(".")) targets.add(target(key, source));
    }
    let found: Export | null = null;
    for (const next of targets) {
      const exported =
        next === undefined ? UNKNOWN_EXPORT : resolve(next, name);
      if (exported === null) continue;
      // Two modules that both export it: the same binding, or none.
      if (found !== null && !sameExport(found, exported)) {
        return UNKNOWN_EXPORT;
      }
      found = exported;
    }
    return found;
  }

  /** `name` as module `key` exports it from its own code; `null` if it doesn't. */
  function localExport(
    key: string,
    module: ModuleInfo,
    name: string,
  ): Export | null {
    if (!module.code.includes("export")) return null;
    const body = module.body();
    if (!body) return UNKNOWN_EXPORT;
    /** Names being classified, so a cycle doesn't recurse forever. */
    const pending = new Set<string>();

    /**
     * What `node` (a function, a class, any other value) holds: none of
     * the library's components when its module can't reach one, or when
     * every name it mentions is the module's and holds none.
     */
    const opaque = (node?: Node): Export => {
      if (!reachesComponents(key)) return VALUE;
      if (!node) return UNKNOWN_EXPORT;
      let holds = false;
      forEachNode(node, (inner) => {
        if (holds || inner.type !== "Identifier") return;
        if (declared(inner.name).kind !== "value") holds = true;
      });
      return holds ? UNKNOWN_EXPORT : VALUE;
    };

    /** What the module's own binding `local` holds; a global holds none. */
    const declared = (local: string): Export => {
      if (pending.has(local)) return VALUE;
      pending.add(local);
      try {
        const binding = module.imports.get(local);
        if (binding) return imported(key, binding.source, binding.imported);
        for (const statement of body) {
          const declaration =
            statement.type === "ExportNamedDeclaration" ||
            statement.type === "ExportDefaultDeclaration"
              ? statement.declaration
              : statement;
          if (declaration?.type === "VariableDeclaration") {
            for (const declarator of declaration.declarations) {
              if (declarator.id.type !== "Identifier") {
                if (
                  extractIdentifiers(declarator.id as Pattern).some(
                    (id) => id.name === local,
                  )
                ) {
                  return opaque(declarator.init as Node | undefined);
                }
              } else if (declarator.id.name === local) {
                return declarator.init
                  ? holdingOf(declarator.init as Node)
                  : VALUE;
              }
            }
          } else if (
            (declaration?.type === "FunctionDeclaration" ||
              declaration?.type === "ClassDeclaration") &&
            declaration.id?.name === local
          ) {
            return opaque(declaration as Node);
          }
        }
        return VALUE;
      } finally {
        pending.delete(local);
      }
    };

    const holdingOf = (node: Node): Export => {
      switch (node.type) {
        case "Identifier":
          return declared(node.name);
        case "ObjectExpression":
          return membersOf(node, undefined);
        case "CallExpression": {
          const { callee, arguments: args } = node;
          if (
            callee.type === "MemberExpression" &&
            !callee.computed &&
            callee.object.type === "Identifier" &&
            callee.object.name === "Object" &&
            callee.property.type === "Identifier" &&
            callee.property.name === "assign" &&
            args.length === 2 &&
            args[1].type === "ObjectExpression"
          ) {
            const root = holdingOf(args[0] as Node);
            if (root.kind === "unknown" || root.kind === "members") {
              return UNKNOWN_EXPORT;
            }
            return membersOf(
              args[1] as Node,
              root.kind === "component" ? root.key : undefined,
            );
          }
          return opaque(node);
        }
        default:
          return opaque(node);
      }
    };

    const membersOf = (node: Node, self: string | undefined): Export => {
      if (node.type !== "ObjectExpression") return UNKNOWN_EXPORT;
      const members = new Map<string, Node>();
      for (const property of node.properties) {
        if (
          property.type !== "Property" ||
          property.computed ||
          property.kind !== "init"
        ) {
          return UNKNOWN_EXPORT;
        }
        const keyName =
          property.key.type === "Identifier"
            ? property.key.name
            : property.key.type === "Literal"
              ? String(property.key.value)
              : undefined;
        if (keyName === undefined) return UNKNOWN_EXPORT;
        members.set(keyName, property.value as Node);
      }
      return {
        kind: "members",
        self,
        member: (member) => {
          const value = members.get(member);
          return value ? holdingOf(value) : VALUE;
        },
      };
    };

    for (const statement of body) {
      if (statement.type === "ExportDefaultDeclaration") {
        if (name !== "default") continue;
        const { declaration } = statement;
        return declaration.type === "FunctionDeclaration" ||
          declaration.type === "ClassDeclaration"
          ? opaque(declaration as Node)
          : holdingOf(declaration as Node);
      }
      if (statement.type !== "ExportNamedDeclaration" || statement.source) {
        continue;
      }
      const { declaration } = statement;
      if (declaration?.type === "VariableDeclaration") {
        for (const declarator of declaration.declarations) {
          if (declarator.id.type !== "Identifier") {
            if (
              extractIdentifiers(declarator.id as Pattern).some(
                (id) => id.name === name,
              )
            ) {
              return opaque(declarator.init as Node | undefined);
            }
            continue;
          }
          if (declarator.id.name === name) {
            return declarator.init ? holdingOf(declarator.init as Node) : VALUE;
          }
        }
      } else if (
        (declaration?.type === "FunctionDeclaration" ||
          declaration?.type === "ClassDeclaration") &&
        declaration.id?.name === name
      ) {
        return opaque(declaration as Node);
      }
      for (const specifier of statement.specifiers) {
        const exported =
          specifier.exported.type === "Identifier"
            ? specifier.exported.name
            : String(specifier.exported.value);
        if (exported !== name) continue;
        return specifier.local.type === "Identifier"
          ? declared(specifier.local.name)
          : UNKNOWN_EXPORT;
      }
    }
    return null;
  }

  return (module, name) => resolve(module, name) ?? VALUE;
}

/** Whether two exports render the same: both values, or one component. */
function sameExport(a: Export, b: Export): boolean {
  if (a.kind === "value" || b.kind === "value") return a.kind === b.kind;
  return a.kind === "component" && b.kind === "component" && a.key === b.key;
}

/** A module's imports and re-exports, from the lexer; its body when asked. */
function readModule(code: string, typescript: boolean): ModuleInfo {
  const module: ModuleInfo = {
    reExports: new Map(),
    namespaces: new Map(),
    stars: [],
    imports: new Map(),
    unread: false,
    code,
    body: () => undefined,
  };
  for (const statement of lexImportsExports(code)) {
    if (!statement.source) {
      module.unread = true;
      continue;
    }
    if (statement.typeOnly) continue;
    const source = statement.source.value;
    if (statement.kind === "import") {
      for (const specifier of statement.specifiers) {
        if (specifier.typeOnly) continue;
        module.imports.set(specifier.local, {
          source,
          imported: specifier.kind === "namespace" ? "*" : specifier.imported,
        });
      }
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (specifier.typeOnly) continue;
      if (specifier.kind === "all") module.stars.push(source);
      else if (specifier.kind === "namespace" && specifier.exported) {
        module.namespaces.set(specifier.exported, source);
      } else if (specifier.exported) {
        module.reExports.set(specifier.exported, {
          source,
          local: specifier.local,
        });
      }
    }
  }
  let body: Node[] | undefined | null = null;
  module.body = () => {
    if (body === null) {
      try {
        const lang = typescript ? ' lang="ts"' : "";
        const ast = parse(
          `<script context="module"${lang}>\n${code}\n</script>`,
          { comments: false, css: false },
        );
        body = (ast.module?.content.body ?? []) as Node[];
      } catch {
        body = undefined;
      }
    }
    return body;
  };
  return module;
}
