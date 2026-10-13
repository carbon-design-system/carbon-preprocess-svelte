/**
 * The usage analysis and the rewrites it drives, for a library. The build
 * plugins load it lazily, so builds without them never evaluate it.
 */
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  analyzeUsage,
  type UsageAnalysis,
  type UsageOptions,
} from "./analyze-usage";
import { type AppUsage, collectAppUsage } from "./app-usage";
import { type ModuleUsage, readLibraryImport } from "./call-sites";
import {
  type Library,
  type LibraryImport,
  type LibrarySpec,
  libraryPaths,
  loadLibrary,
} from "./library";
import { type SourceMap, toSourceMap } from "./mapped-text";
import { type SpecializeOptions, specializeComponent } from "./specialize";
import type { CallSite } from "./usage";
import { errorMessage, isSvelteFile, stripQuery } from "./util";
import { formatValue, UNKNOWN } from "./values";

/** What the usage analysis found, for an app's build. */
export type UsageResult = {
  analysis: UsageAnalysis;
  library: Library;
  /** Export names of the library's components that can render (`Button`). */
  liveComponents: Set<string>;
  /** Whether no rendered component can apply class `cls`. */
  isPruned(cls: string): boolean;
};

/** Which feature a failed analysis turns off, and what happens instead, for its warning. */
export type Failure = { feature: string; fallback: string };

function failure(
  spec: LibrarySpec,
  error: unknown,
  { feature, fallback }: Failure,
): string {
  return `${libraryPaths(spec).logPrefix} ${feature} could not analyze this build (${errorMessage(error)}); ${fallback}.`;
}

const NODE_MODULES = /[\\/]node_modules[\\/]/;

/**
 * A bundled module as the analysis reads it: a `.svelte` file's source
 * from disk, anything else as the bundler hands it over. Returns
 * `undefined` for a `.svelte` file's sub-module (`?svelte&type=style`).
 */
function readModuleSource(
  spec: LibrarySpec,
  id: string,
  code: string,
): { file: string; code: string } | undefined {
  const file = stripQuery(id);
  if (!isSvelteFile(file)) {
    // A dependency can't import the app's own components, and its
    // computed `import()`s aren't the app's: read it for the library only.
    if (NODE_MODULES.test(file) && !code.includes(spec.name)) {
      return undefined;
    }
    return { file, code };
  }
  if (file !== id) return undefined;
  try {
    return { file, code: readFileSync(file, "utf8") };
  } catch {
    // Virtual or generated: read its compiled code as a script.
    return { file: `${file}.js`, code };
  }
}

/**
 * Collects call sites module by module during a build, then analyzes them
 * against the library modules the bundle holds. `failed` names what a
 * failed analysis turns off.
 */
export function createUsageCollector(
  spec: LibrarySpec,
  projectRoot: string,
  failed: Failure,
) {
  const library = loadLibrary(spec, projectRoot);
  const modules = new Map<string, { file: string; code: string }>();

  return {
    /** Records module `id`; `code` is what the bundler hands the plugin. */
    add(id: string, code: string): void {
      const source = readModuleSource(spec, id, code);
      if (source) modules.set(id, source);
      else modules.delete(id);
    },
    /** Forgets modules no longer in the build (`vite build --watch`). */
    retain(graph: Set<string>): void {
      for (const id of modules.keys()) if (!graph.has(id)) modules.delete(id);
    },
    /**
     * The analysis for this bundle, or a warning when it can't be done.
     * `bundledIds` are the library's `.svelte` module paths in the
     * bundle; `imports`, the module graph's edges into the library. A
     * component imported in a way the analysis didn't read (an alias)
     * keeps every variant.
     */
    async analyze(
      bundledIds: Iterable<string>,
      options: UsageOptions,
      imports: Iterable<LibraryImport>,
    ): Promise<UsageResult | { warning: string }> {
      try {
        const bundled = new Set<string>();
        for (const id of bundledIds) {
          const key = library.moduleKey(id);
          if (key) bundled.add(key);
        }
        const appUsage = collectAppUsage(modules.values(), library);
        const unread = unreadImports(library, appUsage, imports);
        return toResult(
          await analyzeUsage({
            library,
            bundled,
            modules: unread ? [...appUsage.modules, unread] : appUsage.modules,
            options,
          }),
          library,
        );
      } catch (error) {
        return { warning: failure(spec, error, failed) };
      }
    },
  };
}

export type UsageCollector = ReturnType<typeof createUsageCollector>;

const UNREAD_IMPORT = "imported in a way the analysis can't read (an alias?)";

function openSite(component: string, reason: string, file?: string): CallSite {
  return {
    component,
    open: true,
    props: new Map(),
    slots: null,
    ...(file !== undefined && { location: { file, line: 1 } }),
    reason,
  };
}

function emptyModule(): ModuleUsage {
  return { sites: [], openAll: false, providedContexts: new Set() };
}

/**
 * Open sites for the library modules `edges` import that `appUsage` didn't
 * read the import of (or that an alias imports), or `undefined` if it
 * read them all. An unread import of the barrel opens every component.
 */
function unreadImports(
  library: Library,
  appUsage: AppUsage,
  edges: Iterable<LibraryImport>,
): ModuleUsage | undefined {
  const unread = emptyModule();
  for (const { id, importer, specifier } of edges) {
    const key = library.importKey(id);
    const file = stripQuery(importer);
    if (!key || library.moduleKey(file)) continue;
    if (
      (specifier === undefined || library.isSpecifier(specifier)) &&
      readLibraryImport(library, appUsage.read.get(file), key)
    ) {
      continue;
    }
    if (key === library.barrelKey) unread.openAll = true;
    else unread.sites.push(openSite(key, UNREAD_IMPORT, file));
  }
  return unread.openAll || unread.sites.length > 0 ? unread : undefined;
}

function toResult(analysis: UsageAnalysis, library: Library): UsageResult {
  return {
    analysis,
    library,
    liveComponents: new Set(
      [...analysis.liveComponents].map((key) => path.posix.parse(key).name),
    ),
    isPruned: analysis.isPruned,
  };
}

/**
 * Analyzes `files` (every file that renders the library), with
 * `components` (names or paths) as the bundle. A listed component no file
 * renders keeps every variant.
 */
export async function analyzeFiles(input: {
  library: LibrarySpec;
  projectRoot: string;
  files: Iterable<{ file: string; code: string }>;
  components: Iterable<string>;
  options: UsageOptions;
  failure: Failure;
  /** `collectAppUsage(files)`, if the caller already has it. */
  appUsage?: AppUsage;
}): Promise<UsageResult | { warning: string }> {
  try {
    const library = loadLibrary(input.library, input.projectRoot);
    const bundled: string[] = [];
    for (const component of input.components) {
      const key =
        library.moduleKey(component) ?? library.components.get(component);
      if (key) bundled.push(key);
    }
    return await analyzeBundle(
      library,
      (input.appUsage ?? collectAppUsage(input.files, library)).modules,
      bundled,
      input.options,
    );
  } catch (error) {
    return { warning: failure(input.library, error, input.failure) };
  }
}

/** `analyzeUsage` with module keys `bundled` as the bundle. */
async function analyzeBundle(
  library: Library,
  modules: readonly ModuleUsage[],
  bundled: Iterable<string>,
  options: UsageOptions,
): Promise<UsageResult> {
  const rendered = new Set(
    modules.flatMap((module) => module.sites.map((site) => site.component)),
  );
  const keys = new Set(bundled);
  const unseen = emptyModule();
  for (const key of keys) {
    if (!rendered.has(key)) {
      unseen.sites.push(openSite(key, "not found in `content`"));
    }
  }
  return toResult(
    await analyzeUsage({
      library,
      bundled: keys,
      modules: [...modules, unseen],
      options,
    }),
    library,
  );
}

/** Report lines: per component, the prop values the app passes and why some stay open. */
export function formatPropAwareReport(
  result: UsageResult,
  prunedClasses: ReadonlySet<string>,
  root: string,
): string[] {
  return [
    "  Prop-aware:",
    ...formatCallSites(result, root),
    `    Classes pruned by props: ${prunedClasses.size}`,
  ];
}

/** A library component's export name, from its module key. */
function nameOf(result: UsageResult, key: string): string {
  for (const [name, component] of result.library.components) {
    if (component === key) return name;
  }
  return path.posix.parse(key).name;
}

function formatCallSites(result: UsageResult, root: string): string[] {
  const lines: string[] = [];
  const relative = (file: string) =>
    path.isAbsolute(file) ? path.relative(root, file) : file;

  const entries = [...result.analysis.usages]
    .filter(([, usage]) => usage.appSites.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [key, usage] of entries) {
    const name = nameOf(result, key);
    const sites = usage.appSites.length;
    lines.push(`    ${name} (${sites} call site${sites === 1 ? "" : "s"})`);
    const open = usage.appSites.find((site) => site.open);
    if (open) {
      const where = open.location
        ? ` at ${relative(open.location.file)}:${open.location.line}`
        : "";
      lines.push(`      every variant kept: ${open.reason ?? "open"}${where}`);
      continue;
    }
    if (usage.open) {
      lines.push(`      every variant kept: ${usage.openReason ?? "open"}`);
      continue;
    }
    const propNames = new Set(
      usage.appSites.flatMap((site) => [...site.props.keys()]),
    );
    const why = (prop: string) => {
      const reason = usage.unknownBecause.get(prop);
      return reason ? `: ${reason}` : "";
    };
    for (const prop of [...propNames].sort()) {
      const value = usage.props.get(prop);
      if (value === undefined) continue;
      const omitted = usage.omitted.has(prop) ? " (+ default)" : "";
      const reason = value === UNKNOWN ? why(prop) : "";
      lines.push(
        `      ${prop.padEnd(16)} ${formatValue(value)}${omitted}${reason}`,
      );
    }
    // Props the app doesn't pass that something else leaves unknown.
    for (const [prop, value] of [...usage.props].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (propNames.has(prop) || value !== UNKNOWN) continue;
      if (!usage.unknownBecause.has(prop)) continue;
      lines.push(`      ${prop.padEnd(16)} dynamic${why(prop)}`);
    }
  }
  return lines;
}

/** `file` through symlinks, as the build plugins key sources. */
function realpath(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

/** A rewritten component, as a bundler's `load` returns it. */
export type RewrittenSource = { code: string; map: SourceMap };

/** Library components rewritten for an app, by real path of their source. */
export type SpecializedComponents = {
  sources: Map<string, RewrittenSource>;
  edits: number;
  /**
   * The app's own components whose props came from their call sites in
   * the analyzed files: nothing else may render them.
   */
  closed: Set<string>;
  /** How many of the app's own components `sources` holds. */
  apps: number;
  /** Lines for a report of what it rewrote. */
  report: () => string[];
  /**
   * Whether the analysis read analyzed file `importer`'s import of library
   * module `id` (both real paths). `false` means an import it can't see,
   * such as one through an alias; `true` for a module it doesn't read
   * imports of (a script module, a stylesheet).
   */
  readImport: (importer: string, id: string) => boolean;
};

/**
 * Analyzes `files` (every file that renders the library) and rewrites each
 * library component they render for the props they pass it, and each of
 * the app's own components whose every call site they hold.
 */
export async function specializeFiles(input: {
  library: LibrarySpec;
  projectRoot: string;
  files: Array<{ file: string; code: string }>;
  options?: SpecializeOptions;
  /** Aliased `.svelte` imports the bundler resolved, by `importKey`. */
  resolvedImports?: ReadonlyMap<string, string>;
  /** Also names the report. */
  failure: Failure;
}): Promise<SpecializedComponents | { warning: string }> {
  let appUsage: AppUsage;
  let library: Library;
  let result: UsageResult;
  try {
    library = loadLibrary(input.library, input.projectRoot);
    appUsage = collectAppUsage(input.files, library, input.resolvedImports);
    // Every component the app renders, and nothing else, is bundled.
    result = await analyzeBundle(
      library,
      appUsage.modules,
      appUsage.modules.flatMap((module) =>
        module.sites.map((site) => site.component),
      ),
      {},
    );
  } catch (error) {
    return { warning: failure(input.library, error, input.failure) };
  }

  const src = realpathSync(library.src);
  const sources: SpecializedComponents["sources"] = new Map();
  let edits = 0;
  const rewrites: ComponentRewrite[] = [];
  const appRewrites: Array<{ file: string; edits: number }> = [];
  try {
    for (const key of result.analysis.liveComponents) {
      const scope = result.analysis.scopeFor(key);
      if (!scope) continue;
      const specialized = specializeComponent(scope, input.options);
      edits += specialized.edits;
      rewrites.push({
        key,
        edits: specialized.edits,
        dropped: specialized.dropped,
        unrendered: () =>
          specialized
            .unrendered()
            .map((source) => path.posix.join(path.posix.dirname(key), source)),
      });
      const file = path.join(src, key);
      sources.set(file, {
        code: specialized.code,
        map: toSourceMap(
          specialized.mapped,
          scope.model.code,
          path.basename(file),
        ),
      });
    }
    // The app's own components whose every call site is known: nothing
    // outside `content` renders them, which the build plugins check.
    for (const file of appUsage.closed) {
      const scope = appUsage.scopeFor(file);
      if (!scope) continue;
      const specialized = specializeComponent(scope, input.options);
      appRewrites.push({ file, edits: specialized.edits });
      if (specialized.edits === 0) continue;
      edits += specialized.edits;
      sources.set(realpath(file), {
        code: specialized.code,
        map: toSourceMap(
          specialized.mapped,
          scope.model.code,
          path.basename(file),
        ),
      });
    }
  } catch (error) {
    return { warning: failure(input.library, error, input.failure) };
  }
  const read = new Map(
    [...appUsage.read].map(([file, usage]) => [realpath(file), usage]),
  );
  return {
    sources,
    edits,
    closed: appUsage.closed,
    readImport: (importer, id) => {
      const key = library.importKey(id);
      return !key || readLibraryImport(library, read.get(importer), key);
    },
    apps: appRewrites.filter((rewrite) => rewrite.edits > 0).length,
    report: () =>
      formatSpecializeReport(
        result,
        rewrites,
        appRewrites,
        input.projectRoot,
        input.failure.feature,
      ),
  };
}

/** One library component `specializeFiles` rewrote, for the report. */
type ComponentRewrite = {
  key: string;
  edits: number;
  dropped: number;
  /** Module keys of the children it no longer renders. */
  unrendered: () => string[];
};

function formatSpecializeReport(
  result: UsageResult,
  rewrites: ComponentRewrite[],
  appRewrites: Array<{ file: string; edits: number }>,
  root: string,
  feature: string,
): string[] {
  const name = (key: string) => nameOf(result, key);
  const { spec } = result.library;
  const changed = rewrites
    .filter((rewrite) => rewrite.edits > 0)
    .sort((a, b) => b.edits - a.edits || a.key.localeCompare(b.key));
  const edits = changed.reduce((sum, rewrite) => sum + rewrite.edits, 0);
  const dropped = changed.reduce((sum, rewrite) => sum + rewrite.dropped, 0);
  const width = Math.max(0, ...changed.map(({ key }) => name(key).length));
  const unbundled = new Set(
    changed.flatMap(({ unrendered }) =>
      unrendered().filter((key) => !result.analysis.liveComponents.has(key)),
    ),
  );

  const lines = [
    "",
    `${spec.tool} ${feature} report`,
    `  Rewrote ${changed.length} of ${rewrites.length} ${spec.label} components (${edits} edits, ${dropped} declarations dropped):`,
  ];
  for (const rewrite of changed) {
    const stops =
      rewrite.unrendered().length > 0
        ? `   no longer renders ${rewrite.unrendered().map(name).join(", ")}`
        : "";
    lines.push(
      `    ${name(rewrite.key).padEnd(width)}   ${String(rewrite.edits).padStart(4)} edit${rewrite.edits === 1 ? " " : "s"}${stops}`,
    );
  }
  const appChanged = appRewrites
    .filter((rewrite) => rewrite.edits > 0)
    .map((rewrite) => ({ ...rewrite, name: path.relative(root, rewrite.file) }))
    .sort((a, b) => b.edits - a.edits || a.name.localeCompare(b.name));
  if (appRewrites.length > 0) {
    lines.push(
      `  Rewrote ${appChanged.length} of ${appRewrites.length} app components whose every call site is known:`,
    );
    const appWidth = Math.max(0, ...appChanged.map(({ name }) => name.length));
    for (const rewrite of appChanged) {
      lines.push(
        `    ${rewrite.name.padEnd(appWidth)}   ${String(rewrite.edits).padStart(4)} edit${rewrite.edits === 1 ? "" : "s"}`,
      );
    }
  }
  lines.push(
    `  No longer bundled (${unbundled.size}): ${[...unbundled].map(name).sort().join(", ") || "none"}`,
    "  Call sites:",
    ...formatCallSites(result, root),
  );
  return lines;
}
