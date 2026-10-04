import { readFile } from "node:fs/promises";
import path from "node:path";
import { lexComponent, lexImportsExports } from "sveast/lexer";
import { RE_EXT_SVELTE } from "../constants";
import { isSvelteFile } from "../utils";

const CLASSLIST_LITERAL =
  /classList\.(?:add|remove|toggle)\(\s*["'](bx--[^"']+)["']/g;
const JS_EXT = /\.js$/;

/**
 * A `bx--` class name not preceded by a class-name character, including a
 * trailing-hyphen prefix like the `bx--btn--` in `` `bx--btn--${kind}` ``. A
 * bare `bx--` (as in `/^bx--(overflow-menu|checkbox)/`) is not a class: as a
 * prefix it would keep every Carbon rule.
 */
const CARBON_CLASS_TOKEN = /(?<![\w-])bx--[\w-]+/g;

/**
 * Every `bx--` class name in `text`, as `.bx--…` selectors. With
 * `skipLookups`, classes written as selectors (`closest(".bx--modal")`) are
 * skipped: they find an element rendered elsewhere instead of applying it.
 */
export function extractCarbonClassTokens(
  text: string,
  options?: { skipLookups?: boolean },
): string[] {
  const classes: string[] = [];
  for (const match of text.matchAll(CARBON_CLASS_TOKEN)) {
    if (options?.skipLookups && text[match.index - 1] === ".") continue;
    classes.push(`.${match[0]}`);
  }
  return classes;
}

export function extractRuntimeClassesFromSource(code: string): string[] {
  const classes = new Set<string>();

  for (const match of code.matchAll(CLASSLIST_LITERAL)) {
    classes.add(`.${match[1]}`);
  }

  return [...classes];
}

function resolveRelativeImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) {
    return null;
  }

  const joined = path.posix.join(path.posix.dirname(from), spec);

  if (joined.endsWith(".js") || joined.endsWith(".svelte")) {
    return joined;
  }

  return `${joined}.js`;
}

/** Relative imports in a module's source, as module keys. */
function relativeImports(code: string, moduleKey: string): string[] {
  const imports: string[] = [];
  for (const statement of lexImportsExports(code)) {
    if (statement.kind !== "import" || !statement.source) continue;
    const resolved = resolveRelativeImport(moduleKey, statement.source.value);
    if (resolved) {
      imports.push(resolved);
    }
  }
  return imports;
}

type Scripts = {
  module?: { content: { start: number; end: number } } | null;
  instance?: { content: { start: number; end: number } } | null;
};

/** Relative imports in a component's `<script>`s, as module keys. */
export function componentImports(
  code: string,
  scripts: Scripts,
  moduleKey: string,
): string[] {
  return [scripts.module, scripts.instance].flatMap((script) =>
    script
      ? relativeImports(
          code.slice(script.content.start, script.content.end),
          moduleKey,
        )
      : [],
  );
}

function collectImportsFromCode(
  code: string,
  moduleKey: string,
  isSvelte: boolean,
): string[] {
  if (!isSvelte) {
    return relativeImports(code, moduleKey);
  }
  return componentImports(code, lexComponent(code), moduleKey);
}

export type ModuleGraphCache = {
  importsByModule: Map<string, string[]>;
  runtimeByModule: Map<string, Set<string>>;
  /** Every `.js`/`.svelte` module key under Carbon's `src`. */
  files: Set<string>;
};

function importCandidates(spec: string): string[] {
  return [
    spec,
    spec.replace(JS_EXT, ".svelte"),
    spec.replace(RE_EXT_SVELTE, ".js"),
  ];
}

/**
 * Traces Carbon classes through the relative imports reachable from each
 * exported component: what `cache.runtimeByModule` holds for `.svelte`
 * modules, and every `bx--` class a `.js` module applies (a hoisted
 * `const HIGHLIGHT = "bx--…"`, a `classList` call, a class prefix). `.js`
 * modules load lazily along import paths.
 *
 * `.js` lookups (`closest(".bx--modal")`) are skipped: a shared utility is
 * imported by many components, and each would keep the looked-up component's
 * rules. Comments are scanned too; a stray class only keeps an extra rule.
 */
export async function buildRuntimeClassMap(
  carbonSrcPath: string,
  moduleToComponent: Map<string, string>,
  cache: ModuleGraphCache,
): Promise<Map<string, Set<string>>> {
  const { importsByModule, runtimeByModule, files } = cache;
  const reachableRuntime = new Map<string, Set<string>>();
  const loadPromises = new Map<string, Promise<void>>();

  /** The module `moduleKey` names (`.js` or `.svelte` either way), if it exists. */
  const resolveModule = (moduleKey: string) =>
    importCandidates(moduleKey).find((candidate) => files.has(candidate));

  /** Loads a resolved module's imports and runtime classes once. */
  function ensureModuleLoaded(key: string): Promise<void> {
    if (importsByModule.has(key)) return Promise.resolve();

    let load = loadPromises.get(key);
    if (!load) {
      load = (async () => {
        const code = await readFile(path.join(carbonSrcPath, key), "utf8");
        const isSvelte = isSvelteFile(key);
        const runtime = isSvelte
          ? extractRuntimeClassesFromSource(code)
          : extractCarbonClassTokens(code, { skipLookups: true });

        if (runtime.length > 0) runtimeByModule.set(key, new Set(runtime));

        importsByModule.set(key, collectImportsFromCode(code, key, isSvelte));
      })();
      loadPromises.set(key, load);
    }
    return load;
  }

  async function collectRuntime(start: string): Promise<Set<string>> {
    const cached = reachableRuntime.get(start);
    if (cached) return cached;

    const collected = new Set<string>();
    const visited = new Set<string>();
    const queue = [start];

    for (let head = 0; head < queue.length; head++) {
      const current = resolveModule(queue[head]);

      if (!current || visited.has(current)) continue;

      visited.add(current);
      // biome-ignore lint/performance/noAwaitInLoops: graph walk is intentionally sequential
      await ensureModuleLoaded(current);

      for (const cls of runtimeByModule.get(current) ?? []) collected.add(cls);

      for (const next of importsByModule.get(current) ?? []) {
        for (const candidate of importCandidates(next)) {
          if (!visited.has(candidate)) queue.push(candidate);
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
