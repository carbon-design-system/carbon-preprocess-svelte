import { createHash } from "node:crypto";
import { globSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type {
  Failure,
  RewrittenSource,
  SpecializedComponents,
} from "./analysis";
import { importKey } from "./import-key";
import { collectLibraryImports } from "./imports";
import {
  type LibraryImport,
  type LibraryPaths,
  type LibrarySpec,
  libraryPaths,
} from "./library";
import { installedMajor } from "./package";
import { RE_EXT_STYLESHEET, stripQuery } from "./util";

export type SpecializerOptions = {
  /**
   * Glob patterns (relative to the project root) of every file that
   * renders the library's components. They're analyzed before the build;
   * a module outside them that imports one fails the build, since the
   * components were already rewritten without it.
   *
   * `.svelte` files are read for the props they pass. Every component a
   * script, Markdown, MDX or Astro file imports keeps every prop value.
   * `node_modules` is skipped unless a pattern names it.
   * @default ["src/**\/*.{svelte,svx,md,mdx,astro,js,jsx,ts,tsx,mjs,mts,cjs,cts}"]
   */
  content?: string[];

  /**
   * Replace an `{#if}` whose only live branch is known with that branch
   * instead of keeping an `{#if true}` around it. Svelte 5 only: Svelte 3/4
   * render whitespace differently without the block. Saves under a point of
   * JS.
   * @default true when the installed Svelte is 5 or later
   */
  unwrap?: boolean;

  /**
   * Set to `true` to skip the per-build summary.
   * @default false
   */
  silent?: boolean;

  /**
   * Print what each build rewrote: edits per component, the child
   * components they no longer render, the ones no longer bundled, and the
   * prop values each call site passes (or why it keeps every value).
   * Independent of `silent`.
   * @default false
   */
  report?: boolean;
};

const DEFAULT_CONTENT = [
  "src/**/*.{svelte,svx,md,mdx,astro,js,jsx,ts,tsx,mjs,mts,cjs,cts}",
];
const PATH_SEPARATOR = /[\\/]/;
/** Rollup's prefix for virtual module ids. */
const ROLLUP_VIRTUAL_PREFIX = /^\0/;
/** Files whose imports `collectLibraryImports` can lex. */
const LEXABLE = /\.(svelte|[cm]?[jt]sx?)$/;

const isInNodeModules = (file: string) =>
  file.split(PATH_SEPARATOR).includes("node_modules");

/** Whether module `id`, `file` without its query, has no file on disk. */
const isVirtual = (id: string, file: string) =>
  id.startsWith("\0") || !path.isAbsolute(file);

/** Files matching `patterns`, skipping `node_modules` unless a pattern names it. */
function globContent(patterns: string[], cwd: string): string[] {
  const named = patterns.filter((pattern) => pattern.includes("node_modules"));
  const rest = patterns.filter((pattern) => !named.includes(pattern));
  return [
    ...new Set([
      ...(rest.length > 0
        ? globSync(rest, { cwd, exclude: isInNodeModules })
        : []),
      ...(named.length > 0 ? globSync(named, { cwd }) : []),
    ]),
  ];
}

/**
 * Whether module `code` imports one of `library`'s components. Virtual
 * modules are JavaScript, so they're lexed too: one that only mentions
 * the package (data, a path, `package.json`) doesn't count. In a file
 * the lexer can't read (Markdown, MDX, Astro), any import of it counts.
 */
function importsLibrary(
  library: LibraryPaths,
  file: string,
  code: string,
  virtual: boolean,
): boolean {
  if (!code.includes(library.name)) return false;
  if (!virtual && !LEXABLE.test(file)) {
    return library.patterns.importText.test(code);
  }
  const imported = new Set<string>();
  return (
    collectLibraryImports(library.spec, code, imported) || imported.size > 0
  );
}

/** `file` relative to `root`, through symlinks when `file` exists. */
function relativeTo(
  root: string,
  file: string,
  real: (file: string) => string | undefined = realpath,
): string {
  const resolved = real(file);
  return resolved
    ? path.relative(real(root) ?? root, resolved)
    : path.relative(root, file);
}

function realpath(file: string): string | undefined {
  try {
    return realpathSync(file);
  } catch {
    return undefined;
  }
}

/** Resolves `source` imported from `importer` to a file, as the bundler would. */
export type ImportResolver = (
  source: string,
  importer: string,
) => Promise<string | undefined>;

/** `from "$lib/Card.svelte"`: a non-relative `.svelte` import. */
const ALIAS_SVELTE_IMPORT =
  /\b(?:from|import)\s*["']([^"'./][^"']*\.svelte)["']/g;

/**
 * Resolves the non-relative `.svelte` imports in `files` (aliases like
 * `$lib/Card.svelte`) with the bundler, keeping those that land on one of
 * `files`, by `importKey`.
 */
async function resolveAliases(
  library: LibraryPaths,
  files: Array<{ file: string; code: string }>,
  resolve: ImportResolver,
): Promise<Map<string, string>> {
  const byRealPath = new Map(
    files.map(({ file }) => [realpath(file) ?? file, file] as const),
  );
  const resolved = new Map<string, string>();
  const pending: Array<Promise<void>> = [];
  for (const { file, code } of files) {
    if (!code.includes(".svelte")) continue;
    for (const match of code.matchAll(ALIAS_SVELTE_IMPORT)) {
      const source = match[1];
      if (library.isComponentFile(source)) continue;
      pending.push(
        resolve(source, file).then(
          (id) => {
            if (!id) return;
            const target = stripQuery(id);
            const match = byRealPath.get(realpath(target) ?? target);
            if (match) resolved.set(importKey(file, source), match);
          },
          () => {},
        ),
      );
    }
  }
  await Promise.all(pending);
  return resolved;
}

/** How the plugins name themselves in messages. */
export type PluginNames = {
  /** Names the plugin in messages. */
  plugin: string;
  /** What a failed analysis turns off, for its warning. */
  failure: Failure;
};

/**
 * What the Vite and webpack plugins share: analyze `content` before a
 * build, serve the rewritten sources, and check that no module outside
 * `content` renders the library.
 */
export function createComponentOptimizer(
  spec: LibrarySpec,
  options: SpecializerOptions | undefined,
  names: PluginNames,
) {
  const name = names.plugin;
  const { label } = spec;
  const library = libraryPaths(spec);
  const content = options?.content ?? DEFAULT_CONTENT;
  /** Rewritten sources by the real path of the file. */
  let sources: SpecializedComponents["sources"] = new Map();
  /** Real paths of the files analyzed before the build. */
  const analyzed = new Set<string>();
  /** Files that render the library but weren't analyzed. */
  const missed = new Set<string>();
  /** Modules with no file that render the library: never analyzable. */
  const virtual = new Set<string>();
  /** Real paths of app components whose props came from analyzed call sites. */
  let closed = new Set<string>();
  /** Those rendered from somewhere else, and by what. */
  const escaped = new Map<string, string[]>();
  /** Analyzed files, by name, and the imports of the library in them it didn't read. */
  const unread = new Map<string, Set<string>>();
  /** See `SpecializedComponents.readImport`. */
  let readImport: SpecializedComponents["readImport"] = () => true;
  /**
   * The last analysis and a hash of the `content` it read: watch rebuilds
   * and SvelteKit's second (server or client) build reuse it unless a
   * file changed.
   */
  let last:
    | {
        hash: string;
        result: SpecializedComponents | { warning: string };
      }
    | undefined;
  /**
   * Real paths, per build: every module is checked, and the bundler asks
   * about the same files many times.
   */
  const realpaths = new Map<string, string | undefined>();
  const real = (file: string): string | undefined => {
    if (!realpaths.has(file)) realpaths.set(file, realpath(file));
    return realpaths.get(file);
  };

  return {
    /** Analyzes `content` under `root`; call before each build. */
    async prepare(
      root: string,
      /** The bundler's resolver, for aliased imports (`$lib/X.svelte`). */
      resolve?: ImportResolver,
    ): Promise<{ warning?: string; info?: string; report?: string[] }> {
      sources = new Map();
      realpaths.clear();
      unread.clear();
      readImport = () => true;
      analyzed.clear();
      missed.clear();
      virtual.clear();
      closed = new Set();
      escaped.clear();

      const files: Array<{ file: string; code: string }> = [];
      const hash = createHash("sha1");
      for (const file of globContent(content, root)) {
        const absolute = path.resolve(root, file);
        let code: string;
        try {
          code = readFileSync(absolute, "utf8");
        } catch {
          continue; // A directory, or gone since the glob ran.
        }
        files.push({ file: absolute, code });
        hash.update(`${absolute}\0${code}\0`);
        analyzed.add(real(absolute) ?? absolute);
      }

      const resolvedImports = resolve
        ? await resolveAliases(library, files, resolve)
        : undefined;
      for (const [key, file] of resolvedImports ?? []) {
        hash.update(`${key}\0${file}\0`);
      }

      const digest = hash.digest("hex");
      if (last?.hash !== digest) {
        // Loaded lazily: builds without this plugin never evaluate the analyzer.
        const { specializeFiles } = await import("./analysis");
        last = {
          hash: digest,
          result: await specializeFiles({
            library: spec,
            projectRoot: root,
            files,
            resolvedImports,
            failure: names.failure,
            options: {
              unwrap:
                options?.unwrap ?? (installedMajor("svelte", root) ?? 0) >= 5,
            },
          }),
        };
      }
      const { result } = last;
      if ("warning" in result) return { warning: result.warning };
      sources = result.sources;
      readImport = result.readImport;
      closed = new Set([...result.closed].map((file) => real(file) ?? file));
      return {
        info: options?.silent
          ? undefined
          : `rewrote ${sources.size - result.apps} ${label} components${result.apps > 0 ? ` and ${result.apps} of the app's own` : ""} for this app (${result.edits} edits)`,
        report: options?.report ? result.report() : undefined,
      };
    },

    /** The files `prepare` analyzed. */
    get analyzed(): ReadonlySet<string> {
      return analyzed;
    },

    /**
     * Whether file `id` may be served rewritten, now or after `content`
     * changes: a library component, or an app component in `content`.
     */
    rewritable(id: string): boolean {
      const file = stripQuery(id);
      if (!file.endsWith(".svelte")) return false;
      return library.isComponentFile(file) || analyzed.has(real(file) ?? file);
    },

    /** The rewritten source of module `id`: a library component, or an app component whose every call site is known. */
    load(id: string): RewrittenSource | undefined {
      if (sources.size === 0) return undefined;
      // Svelte's style sub-modules (`?svelte&type=style`) aren't the source.
      const [file, query = ""] = id.split("?");
      if (query.includes("svelte")) return undefined;
      const resolved = real(file);
      return resolved ? sources.get(resolved) : undefined;
    },

    /** Records module `id` if it renders the library without having been analyzed. */
    check(id: string, code: string, root: string): void {
      if (sources.size === 0) return;
      const file = stripQuery(id);
      if (library.isComponentFile(file) || RE_EXT_STYLESHEET.test(file)) {
        return;
      }
      if (analyzed.has(real(file) ?? file)) return;
      const unbacked = isVirtual(id, file);
      if (!importsLibrary(library, file, code, unbacked)) return;
      // Named as the app imports it, without Rollup's `\0` prefix.
      if (unbacked) virtual.add(id.replace(ROLLUP_VIRTUAL_PREFIX, ""));
      else missed.add(relativeTo(root, file, real));
    },

    /** Whether module `id` is an app component whose props were read from its call sites. */
    isClosed(id: string): boolean {
      if (closed.size === 0 || id.includes("?")) return false;
      return closed.has(real(id) ?? id);
    },

    /**
     * Records the modules that import app component `id` (see `isClosed`):
     * its props are only known if the analyzed files are all that render
     * it. `undefined` stands for an importer with no file (an entry, a
     * `require.context`); `dynamic` for any `import()` of it.
     */
    checkImporters(
      id: string,
      importers: Array<string | undefined>,
      dynamic: boolean,
      root: string,
    ): void {
      const name = relativeTo(root, id, real);
      const outside = importers.filter((importer) => {
        if (importer === undefined) return true;
        const file = stripQuery(importer);
        return !analyzed.has(real(file) ?? file);
      });
      if (dynamic) outside.push("a dynamic import");
      if (outside.length === 0) return;
      escaped.set(
        name,
        [...new Set(outside)].map((importer) =>
          importer === undefined
            ? "the bundler"
            : path.isAbsolute(stripQuery(importer))
              ? relativeTo(root, stripQuery(importer), real)
              : importer,
        ),
      );
    },

    /**
     * Records an edge of the bundler's module graph into the library
     * unless the analysis read it. `check` reads module text; the graph
     * also has imports no text names the library in, such as one through
     * an alias (`import { Button } from "@lib"`).
     */
    checkLibraryImport(edge: LibraryImport, root: string): void {
      if (sources.size === 0) return;
      const { id, importer, specifier } = edge;
      const file = stripQuery(importer);
      if (!library.importKey(id) || library.moduleKey(file)) return;
      if (isVirtual(importer, file)) {
        virtual.add(importer.replace(ROLLUP_VIRTUAL_PREFIX, ""));
        return;
      }
      const resolved = real(file) ?? file;
      if (!analyzed.has(resolved)) {
        missed.add(relativeTo(root, file, real));
        return;
      }
      const target = real(stripQuery(id)) ?? stripQuery(id);
      const aliased =
        specifier !== undefined && !library.isSpecifier(specifier);
      if (!aliased && readImport(resolved, target)) return;
      const name = relativeTo(root, file, real);
      const imports = unread.get(name) ?? new Set();
      imports.add(
        aliased
          ? `\`${specifier}\``
          : library.importKey(target) === library.barrelKey
            ? `\`${spec.name}\``
            : `${label}'s ${path.basename(target, path.extname(target))}`,
      );
      unread.set(name, imports);
    },

    /** The build error for the modules `check` recorded, if any. */
    error(): string | undefined {
      const errors: string[] = [];
      for (const [component, importers] of escaped) {
        errors.push(
          `${name} read the props of ${component} from its call sites in \`content\`, but ${importers.join(", ")} also ${importers.length === 1 ? "renders" : "render"} it. Add those files to \`content\`.`,
        );
      }
      if (missed.size > 0) {
        errors.push(
          `${name} rewrote ${label} components before seeing ${[...missed].join(", ")}, which ${missed.size === 1 ? "imports" : "import"} them. Add those files to \`content\` (now ${JSON.stringify(content)}); only a pattern that names \`node_modules\` reaches inside it.`,
        );
      }
      for (const [file, imports] of unread) {
        errors.push(
          `${name} can't read how ${file} imports ${[...imports].join(", ")}, so it rewrote ${label} without that file's call sites. Import ${label} from \`${spec.name}\` there, not through an alias, or remove ${name}.`,
        );
      }
      if (virtual.size > 0) {
        errors.push(
          `${name} can't analyze ${[...virtual].join(", ")}, which ${virtual.size === 1 ? `imports ${label} components but has` : `import ${label} components but have`} no file on disk. Import them from a file in \`content\` instead, or remove ${name}.`,
        );
      }
      return errors.length > 0
        ? `${library.logPrefix} ${errors.join(" ")}`
        : undefined;
    },
  };
}

export type ComponentOptimizer = ReturnType<typeof createComponentOptimizer>;
