import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { walk } from "estree-walker";
import { parse } from "svelte/compiler";
import { RE_EXT_SVELTE } from "../constants";
import { isSvelteFile } from "../utils";

const CLASSLIST_LITERAL =
  /classList\.(?:add|remove|toggle)\(\s*["'](bx--[^"']+)["']/g;
const JS_EXT = /\.js$/;

export function extractRuntimeClassesFromSource(code: string): string[] {
  const classes = new Set<string>();

  for (const match of code.matchAll(CLASSLIST_LITERAL)) {
    classes.add(`.${match[1]}`);
  }

  return [...classes];
}

export function resolveRelativeImport(
  from: string,
  spec: string,
): string | null {
  if (!spec.startsWith(".")) {
    return null;
  }

  const joined = path.posix.join(path.posix.dirname(from), spec);

  if (joined.endsWith(".js") || joined.endsWith(".svelte")) {
    return joined;
  }

  return `${joined}.js`;
}

/**
 * `import … from "…"` / `import "…"` sources in a plain JS module. Carbon's
 * utilities are simple enough that this matches a full Svelte-parser walk
 * exactly (checked against every module in carbon-components-svelte) at
 * ~1% of the cost. `.svelte` modules still go through the parser.
 */
const JS_IMPORT_SOURCE =
  /\bimport\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']([^"']+)["']/g;

function collectImportsFromCode(
  code: string,
  moduleKey: string,
  isSvelte: boolean,
): string[] {
  const imports: string[] = [];
  const add = (spec: string) => {
    const resolved = resolveRelativeImport(moduleKey, spec);
    if (resolved) {
      imports.push(resolved);
    }
  };

  if (!isSvelte) {
    for (const match of code.matchAll(JS_IMPORT_SOURCE)) {
      add(match[1]);
    }
    return imports;
  }

  walk(parse(code, { filename: moduleKey }), {
    enter(node) {
      if (node.type === "ImportDeclaration" && node.source?.value) {
        add(String(node.source.value));
      }
    },
  });

  return imports;
}

export type ModuleGraphCache = {
  importsByModule: Map<string, string[]>;
  runtimeByModule: Map<string, Set<string>>;
  /**
   * Every `.js`/`.svelte` module key under the Carbon `src` directory, when
   * the caller has already listed them. Import resolution then never touches
   * the filesystem; without it, each candidate path is checked with
   * `existsSync`.
   */
  files?: Set<string>;
};

function importCandidates(spec: string): string[] {
  return [
    spec,
    spec.replace(JS_EXT, ".svelte"),
    spec.replace(RE_EXT_SVELTE, ".js"),
  ];
}

/**
 * `existsSync` is a blocking syscall and the same `moduleKey` gets re-resolved
 * repeatedly: once per BFS queue entry, again inside `ensureModuleLoaded`, and
 * again from every component whose import graph reaches a shared module (e.g.
 * a common utility). The filesystem doesn't change mid-build, so cache by
 * input string across the whole `buildRuntimeClassMap` call.
 */
function resolveExistingModuleKey(
  carbonSrcPath: string,
  moduleKey: string,
  cache: Map<string, string | null>,
  files: Set<string> | undefined,
): string | null {
  const cached = cache.get(moduleKey);
  if (cached !== undefined) return cached;

  let resolved: string | null = null;

  for (const candidate of importCandidates(moduleKey)) {
    const exists = files
      ? files.has(candidate)
      : existsSync(path.join(carbonSrcPath, candidate));
    if (exists) {
      resolved = candidate;
      break;
    }
  }

  cache.set(moduleKey, resolved);
  return resolved;
}

/**
 * Trace `classList` literals through relative imports reachable from exported
 * components. Only loads `.js` modules lazily along import paths.
 */
export async function buildRuntimeClassMap(
  carbonSrcPath: string,
  moduleToComponent: Map<string, string>,
  cache: ModuleGraphCache,
): Promise<Map<string, Set<string>>> {
  const { importsByModule, runtimeByModule, files } = cache;
  const reachableRuntime = new Map<string, Set<string>>();
  const resolveCache = new Map<string, string | null>();
  const loadPromises = new Map<string, Promise<void>>();
  const missingModules = new Set<string>();

  async function ensureModuleLoaded(moduleKey: string): Promise<void> {
    if (missingModules.has(moduleKey)) {
      return;
    }

    const resolvedKey = resolveExistingModuleKey(
      carbonSrcPath,
      moduleKey,
      resolveCache,
      files,
    );

    if (!resolvedKey) {
      missingModules.add(moduleKey);
      return;
    }

    if (importsByModule.has(resolvedKey)) {
      return;
    }

    const pending = loadPromises.get(resolvedKey);
    if (pending) {
      await pending;
      return;
    }

    const load = (async () => {
      const filePath = path.join(carbonSrcPath, resolvedKey);
      const code = await readFile(filePath, "utf8");
      const runtime = extractRuntimeClassesFromSource(code);

      if (runtime.length > 0) {
        runtimeByModule.set(resolvedKey, new Set(runtime));
      }

      importsByModule.set(
        resolvedKey,
        collectImportsFromCode(code, resolvedKey, isSvelteFile(resolvedKey)),
      );
    })();
    loadPromises.set(resolvedKey, load);
    await load;
  }

  async function collectRuntime(start: string): Promise<Set<string>> {
    const cached = reachableRuntime.get(start);
    if (cached) {
      return cached;
    }

    const collected = new Set<string>();
    const visited = new Set<string>();
    const queue = [start];

    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];

      const resolvedCurrent = resolveExistingModuleKey(
        carbonSrcPath,
        current,
        resolveCache,
        files,
      );

      if (!resolvedCurrent || visited.has(resolvedCurrent)) {
        continue;
      }

      visited.add(resolvedCurrent);
      // biome-ignore lint/performance/noAwaitInLoops: graph walk is intentionally sequential
      await ensureModuleLoaded(resolvedCurrent);

      for (const cls of runtimeByModule.get(resolvedCurrent) ?? []) {
        collected.add(cls);
      }

      for (const next of importsByModule.get(resolvedCurrent) ?? []) {
        for (const candidate of importCandidates(next)) {
          if (!visited.has(candidate)) {
            queue.push(candidate);
          }
        }
      }
    }

    reachableRuntime.set(start, collected);
    return collected;
  }

  const componentClasses = new Map<string, Set<string>>();

  await Promise.all(
    [...moduleToComponent.entries()].map(async ([moduleKey, componentName]) => {
      const runtime = await collectRuntime(moduleKey);
      if (runtime.size > 0) {
        componentClasses.set(componentName, runtime);
      }
    }),
  );

  return componentClasses;
}
