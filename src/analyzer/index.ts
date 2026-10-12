/**
 * Entry point the CSS plugins load lazily for `propAware`, so
 * builds without it never evaluate the analyzer.
 */
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { CarbonSvelte, LOG_PREFIX } from "../constants";
import { resolveCarbonRoot } from "../indexer/resolve-carbon-root";
import type { PropAwareUsage } from "../plugins/create-optimized-css";
import {
  CARBON_BARREL_KEY,
  type CarbonImport,
  carbonImportKey,
  carbonModuleKey,
  errorMessage,
  isCarbonSpecifier,
  isSvelteFile,
  stripQuery,
} from "../utils";
import {
  analyzeUsage,
  type PropAwareOptions,
  type UsageAnalysis,
} from "./analyze-usage";
import { type AppUsage, collectAppUsage } from "./app-usage";
import {
  type CarbonComponents,
  type ModuleUsage,
  readCarbonComponents,
  readCarbonImport,
} from "./call-sites";
import { type SourceMap, toSourceMap } from "./mapped-text";
import { type SpecializeOptions, specializeComponent } from "./specialize";
import { formatValue, UNKNOWN } from "./values";

export type PropAwareResult = PropAwareUsage & {
  analysis: UsageAnalysis;
  carbon: CarbonComponents;
};

/** Which feature a failed analysis turns off, for its warning. */
type Failure = { feature: string; fallback: string };

const PROP_AWARE_FAILURE: Failure = {
  feature: "propAware",
  fallback: "Carbon CSS was pruned without it",
};
const SPECIALIZE_FAILURE: Failure = {
  feature: "optimizeComponents",
  fallback: "Carbon components were bundled unchanged",
};

function failure(
  error: unknown,
  { feature, fallback } = PROP_AWARE_FAILURE,
): string {
  return `${LOG_PREFIX} ${feature} could not analyze this build (${errorMessage(error)}); ${fallback}.`;
}

const NODE_MODULES = /[\\/]node_modules[\\/]/;

/**
 * A bundled module as the analysis reads it: a `.svelte` file's source
 * from disk, anything else as the bundler hands it over. Returns
 * `undefined` for a `.svelte` file's sub-module (`?svelte&type=style`).
 */
function readModuleSource(
  id: string,
  code: string,
): { file: string; code: string } | undefined {
  const file = stripQuery(id);
  if (!isSvelteFile(file)) {
    // A dependency can't import the app's own components, and its
    // computed `import()`s aren't the app's: read it for Carbon only.
    if (NODE_MODULES.test(file) && !code.includes(CarbonSvelte.Components)) {
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
 * against the Carbon modules the bundle holds.
 */
export function createUsageCollector(projectRoot: string) {
  const carbonRoot = resolveCarbonRoot(projectRoot);
  const carbon = readCarbonComponents(carbonRoot);
  const modules = new Map<string, { file: string; code: string }>();

  return {
    /** Records module `id`; `code` is what the bundler hands the plugin. */
    add(id: string, code: string): void {
      const source = readModuleSource(id, code);
      if (source) modules.set(id, source);
      else modules.delete(id);
    },
    /** Forgets modules no longer in the build (`vite build --watch`). */
    retain(graph: Set<string>): void {
      for (const id of modules.keys()) if (!graph.has(id)) modules.delete(id);
    },
    /**
     * The analysis for this bundle, or a warning when it can't be done.
     * `bundledIds` are the Carbon `.svelte` module paths in the bundle;
     * `carbonImports`, the module graph's edges into Carbon. A component
     * imported in a way the analysis didn't read (an alias) keeps every
     * variant.
     */
    async analyze(
      bundledIds: Iterable<string>,
      options: PropAwareOptions,
      carbonImports: Iterable<CarbonImport> = [],
    ): Promise<PropAwareResult | { warning: string }> {
      try {
        const bundled = new Set<string>();
        for (const id of bundledIds) {
          const key = carbonModuleKey(id);
          if (key) bundled.add(key);
        }
        const appUsage = collectAppUsage(modules.values(), carbon);
        const unread = unreadCarbonImports(appUsage, carbonImports);
        return await toResult(
          await analyzeUsage({
            carbonRoot,
            carbon,
            bundled,
            modules: unread ? [...appUsage.modules, unread] : appUsage.modules,
            options,
          }),
          carbon,
        );
      } catch (error) {
        return { warning: failure(error) };
      }
    },
  };
}

export type UsageCollector = ReturnType<typeof createUsageCollector>;

const UNREAD_IMPORT = "imported in a way the analysis can't read (an alias?)";

/**
 * Open sites for the Carbon modules `edges` import that `appUsage` didn't
 * read the import of (or that an alias imports), or `undefined` if it
 * read them all. An unread import of the barrel opens every component.
 */
function unreadCarbonImports(
  appUsage: AppUsage,
  edges: Iterable<CarbonImport>,
): ModuleUsage | undefined {
  const unread: ModuleUsage = {
    sites: [],
    openAll: false,
    providedContexts: new Set(),
  };
  for (const { id, importer, specifier } of edges) {
    const key = carbonImportKey(id);
    const file = stripQuery(importer);
    if (!key || carbonModuleKey(file)) continue;
    if (
      (specifier === undefined || isCarbonSpecifier(specifier)) &&
      readCarbonImport(appUsage.read.get(file), key)
    ) {
      continue;
    }
    if (key === CARBON_BARREL_KEY) unread.openAll = true;
    else {
      unread.sites.push({
        component: key,
        open: true,
        props: new Map(),
        slots: null,
        location: { file, line: 1 },
        reason: UNREAD_IMPORT,
      });
    }
  }
  return unread.openAll || unread.sites.length > 0 ? unread : undefined;
}

function toResult(
  analysis: UsageAnalysis,
  carbon: CarbonComponents,
): PropAwareResult {
  return {
    analysis,
    carbon,
    liveComponents: new Set(
      [...analysis.liveComponents].map((key) => path.posix.parse(key).name),
    ),
    isPruned: analysis.isPruned,
  };
}

/**
 * For `optimizeCarbonCss` and the CLI: analyze `files` (the `content`
 * globs), with `components` (names or paths) as the bundle. A listed
 * component no file renders keeps every variant.
 */
export async function analyzeFiles(input: {
  projectRoot: string;
  files: Iterable<{ file: string; code: string }>;
  components: Iterable<string>;
  options: PropAwareOptions;
  /** Names the feature in the warning when analysis fails. */
  failure?: Failure;
  /** `collectAppUsage(files)`, if the caller already has it. */
  appUsage?: AppUsage;
}): Promise<PropAwareResult | { warning: string }> {
  try {
    const carbonRoot = resolveCarbonRoot(input.projectRoot);
    const carbon = readCarbonComponents(carbonRoot);
    const modules = [
      ...(input.appUsage ?? collectAppUsage(input.files, carbon)).modules,
    ];

    const rendered = new Set(
      modules.flatMap((module) => module.sites.map((site) => site.component)),
    );
    const bundled = new Set<string>();
    const unseen: ModuleUsage = {
      sites: [],
      openAll: false,
      providedContexts: new Set(),
    };
    for (const component of input.components) {
      const key = carbonModuleKey(component) ?? carbon.get(component);
      if (!key) continue;
      bundled.add(key);
      if (!rendered.has(key)) {
        unseen.sites.push({
          component: key,
          open: true,
          props: new Map(),
          slots: null,
          reason: "not found in `content`",
        });
      }
    }
    modules.push(unseen);

    return toResult(
      await analyzeUsage({
        carbonRoot,
        carbon,
        bundled,
        modules,
        options: input.options,
      }),
      carbon,
    );
  } catch (error) {
    return { warning: failure(error, input.failure) };
  }
}

/** Report lines: per component, the prop values the app passes and why some stay open. */
export function formatPropAwareReport(
  result: PropAwareResult,
  prunedClasses: ReadonlySet<string>,
  root: string,
): string[] {
  return [
    "  Prop-aware:",
    ...formatCallSites(result, root),
    `    Classes pruned by props: ${prunedClasses.size}`,
  ];
}

/** A Carbon component's export name, from its module key. */
function nameOf(result: PropAwareResult, key: string): string {
  for (const [name, component] of result.carbon) {
    if (component === key) return name;
  }
  return path.posix.parse(key).name;
}

function formatCallSites(result: PropAwareResult, root: string): string[] {
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

/** Carbon components rewritten for an app, by real path of their source. */
export type SpecializedComponents = {
  sources: Map<string, { code: string; map: SourceMap }>;
  edits: number;
  /**
   * The app's own components whose props came from their call sites in
   * the analyzed files: nothing else may render them.
   */
  closed: Set<string>;
  /** How many of the app's own components `sources` holds. */
  apps: number;
  /** Lines for `optimizeComponents({ report: true })`. */
  report: () => string[];
  /**
   * Whether the analysis read analyzed file `importer`'s import of Carbon
   * module `id` (both real paths). `false` means an import it can't see,
   * such as one through an alias; `true` for a module it doesn't read
   * imports of (a Carbon script, a stylesheet).
   */
  readImport: (importer: string, id: string) => boolean;
};

/**
 * Analyzes `files` (every file that renders Carbon) and rewrites each
 * Carbon component they render for the props they pass it.
 */
export async function specializeFiles(input: {
  projectRoot: string;
  files: Array<{ file: string; code: string }>;
  options?: SpecializeOptions;
  /** Aliased `.svelte` imports the bundler resolved, by `importKey`. */
  resolvedImports?: ReadonlyMap<string, string>;
}): Promise<SpecializedComponents | { warning: string }> {
  let appUsage: AppUsage;
  try {
    const carbon = readCarbonComponents(resolveCarbonRoot(input.projectRoot));
    appUsage = collectAppUsage(input.files, carbon, input.resolvedImports);
  } catch (error) {
    return { warning: failure(error, SPECIALIZE_FAILURE) };
  }
  const components = new Set(
    appUsage.modules.flatMap((module) =>
      module.sites.map((site) => site.component),
    ),
  );
  const result = await analyzeFiles({
    projectRoot: input.projectRoot,
    files: input.files,
    components: [...components].map(
      (key) => `${CarbonSvelte.Components}/src/${key}`,
    ),
    options: {},
    failure: SPECIALIZE_FAILURE,
    appUsage,
  });
  if ("warning" in result) return result;

  const carbonSrc = realpathSync(
    path.join(resolveCarbonRoot(input.projectRoot), "src"),
  );
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
      const file = path.join(carbonSrc, key);
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
    return { warning: failure(error, SPECIALIZE_FAILURE) };
  }
  const read = new Map(
    [...appUsage.read].map(([file, usage]) => [realpath(file), usage]),
  );
  return {
    sources,
    edits,
    closed: appUsage.closed,
    readImport: (importer, id) => {
      const key = carbonImportKey(id);
      return !key || readCarbonImport(read.get(importer), key);
    },
    apps: appRewrites.filter((rewrite) => rewrite.edits > 0).length,
    report: () =>
      formatSpecializeReport(result, rewrites, appRewrites, input.projectRoot),
  };
}

/** One Carbon component `specializeFiles` rewrote, for the report. */
type ComponentRewrite = {
  key: string;
  edits: number;
  dropped: number;
  /** Module keys of the children it no longer renders. */
  unrendered: () => string[];
};

function formatSpecializeReport(
  result: PropAwareResult,
  rewrites: ComponentRewrite[],
  appRewrites: Array<{ file: string; edits: number }>,
  root: string,
): string[] {
  const name = (key: string) => nameOf(result, key);
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
    "carbon-preprocess-svelte optimizeComponents report",
    `  Rewrote ${changed.length} of ${rewrites.length} Carbon components (${edits} edits, ${dropped} declarations dropped):`,
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
