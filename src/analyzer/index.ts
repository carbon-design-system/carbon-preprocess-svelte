/**
 * Entry point the CSS plugins load lazily for `experimental.propAware`, so
 * builds without it never evaluate the analyzer.
 */
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { CarbonSvelte } from "../constants";
import { resolveCarbonRoot } from "../indexer/resolve-carbon-root";
import type { PropAwareUsage } from "../plugins/create-optimized-css";
import { isSvelteFile, stripQuery } from "../utils";
import {
  analyzeUsage,
  carbonModuleKey,
  type PropAwareOptions,
  type UsageAnalysis,
} from "./analyze-usage";
import {
  type CarbonComponents,
  collectScriptUsage,
  collectSourceUsage,
  collectSvelteUsage,
  type ModuleUsage,
  readCarbonComponents,
} from "./call-sites";
import { type SourceMap, toSourceMap } from "./mapped-text";
import { type SpecializeOptions, specializeComponent } from "./specialize";
import { formatValue } from "./values";

export type PropAwareResult = PropAwareUsage & {
  analysis: UsageAnalysis;
  carbon: CarbonComponents;
};

const WARN_PREFIX = "carbon-preprocess-svelte:";

const PROP_AWARE_FAILURE = {
  feature: "experimental.propAware",
  fallback: "Carbon CSS was pruned without it",
};
const SPECIALIZE_FAILURE = {
  feature: "optimizeComponents",
  fallback: "Carbon components were bundled unchanged",
};

function failure(
  error: unknown,
  { feature, fallback } = PROP_AWARE_FAILURE,
): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${WARN_PREFIX} ${feature} could not analyze this build (${message}); ${fallback}.`;
}

/** What a module contributes, read from its source when it's a `.svelte` file. */
export function readModuleUsage(
  id: string,
  code: string,
  carbon: CarbonComponents,
): ModuleUsage | undefined {
  if (!code.includes(CarbonSvelte.Components)) return undefined;
  const file = stripQuery(id);
  if (file === id && isSvelteFile(file)) {
    let source: string | undefined;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      // Virtual or generated: fall through to the module's code.
    }
    if (source !== undefined) return collectSvelteUsage(source, file, carbon);
  }
  return collectScriptUsage(code, file, carbon);
}

/**
 * Collects call sites module by module during a build, then analyzes them
 * against the Carbon modules the bundle holds.
 */
export function createUsageCollector(projectRoot: string) {
  const carbonRoot = resolveCarbonRoot(projectRoot);
  const carbon = readCarbonComponents(carbonRoot);
  const modules = new Map<string, ModuleUsage>();

  return {
    /** Records module `id`; `code` is what the bundler hands the plugin. */
    add(id: string, code: string): void {
      const usage = readModuleUsage(id, code, carbon);
      if (usage) modules.set(id, usage);
      else modules.delete(id);
    },
    /** Forgets modules no longer in the build (`vite build --watch`). */
    retain(graph: Set<string>): void {
      for (const id of modules.keys()) if (!graph.has(id)) modules.delete(id);
    },
    /**
     * The analysis for this bundle, or a warning when it can't be done.
     * `bundledIds` are the Carbon `.svelte` module paths in the bundle.
     */
    async analyze(
      bundledIds: Iterable<string>,
      options: PropAwareOptions,
    ): Promise<PropAwareResult | { warning: string }> {
      try {
        const bundled = new Set<string>();
        for (const id of bundledIds) {
          const key = carbonModuleKey(id);
          if (key) bundled.add(key);
        }
        return await toResult(
          await analyzeUsage({
            carbonRoot,
            carbon,
            bundled,
            modules: modules.values(),
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
  failure?: typeof PROP_AWARE_FAILURE;
}): Promise<PropAwareResult | { warning: string }> {
  try {
    const carbonRoot = resolveCarbonRoot(input.projectRoot);
    const carbon = readCarbonComponents(carbonRoot);
    const modules: ModuleUsage[] = [];
    for (const { file, code } of input.files) {
      // `code` is the file's source here, not a bundler's output.
      modules.push(collectSourceUsage(code, file, carbon));
    }

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
    "  Prop-aware (experimental):",
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
    const propNames = new Set(
      usage.appSites.flatMap((site) => [...site.props.keys()]),
    );
    for (const prop of [...propNames].sort()) {
      const value = usage.props.get(prop);
      if (value === undefined) continue;
      const omitted = usage.omitted.has(prop) ? " (+ default)" : "";
      lines.push(`      ${prop.padEnd(16)} ${formatValue(value)}${omitted}`);
    }
  }
  return lines;
}

/** Carbon components rewritten for an app, by real path of their source. */
export type SpecializedComponents = {
  sources: Map<string, { code: string; map: SourceMap }>;
  edits: number;
  /** Lines for `optimizeComponents({ report: true })`. */
  report: () => string[];
};

/**
 * Analyzes `files` (every file that renders Carbon) and rewrites each
 * Carbon component they render for the props they pass it.
 */
export async function specializeFiles(input: {
  projectRoot: string;
  files: Array<{ file: string; code: string }>;
  options?: SpecializeOptions;
}): Promise<SpecializedComponents | { warning: string }> {
  let carbon: CarbonComponents;
  try {
    carbon = readCarbonComponents(resolveCarbonRoot(input.projectRoot));
  } catch (error) {
    return { warning: failure(error, SPECIALIZE_FAILURE) };
  }
  const components = new Set<string>();
  for (const { file, code } of input.files) {
    const usage = collectSourceUsage(code, file, carbon);
    for (const site of usage.sites) components.add(site.component);
  }
  const result = await analyzeFiles({
    projectRoot: input.projectRoot,
    files: input.files,
    components: [...components].map(
      (key) => `${CarbonSvelte.Components}/src/${key}`,
    ),
    options: {},
    failure: SPECIALIZE_FAILURE,
  });
  if ("warning" in result) return result;

  const carbonSrc = realpathSync(
    path.join(resolveCarbonRoot(input.projectRoot), "src"),
  );
  const sources: SpecializedComponents["sources"] = new Map();
  let edits = 0;
  const rewrites: Array<{
    key: string;
    edits: number;
    dropped: number;
    unrendered: string[];
  }> = [];
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
        unrendered: specialized.unrendered.map((source) =>
          path.posix.join(path.posix.dirname(key), source),
        ),
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
  } catch (error) {
    return { warning: failure(error, SPECIALIZE_FAILURE) };
  }
  return {
    sources,
    edits,
    report: () => formatSpecializeReport(result, rewrites, input.projectRoot),
  };
}

function formatSpecializeReport(
  result: PropAwareResult,
  rewrites: Array<{
    key: string;
    edits: number;
    dropped: number;
    unrendered: string[];
  }>,
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
      unrendered.filter((key) => !result.analysis.liveComponents.has(key)),
    ),
  );

  const lines = [
    "",
    "carbon-preprocess-svelte optimizeComponents report",
    `  Rewrote ${changed.length} of ${rewrites.length} Carbon components (${edits} edits, ${dropped} declarations dropped):`,
  ];
  for (const rewrite of changed) {
    const stops =
      rewrite.unrendered.length > 0
        ? `   no longer renders ${rewrite.unrendered.map(name).join(", ")}`
        : "";
    lines.push(
      `    ${name(rewrite.key).padEnd(width)}   ${String(rewrite.edits).padStart(4)} edit${rewrite.edits === 1 ? " " : "s"}${stops}`,
    );
  }
  lines.push(
    `  No longer bundled (${unbundled.size}): ${[...unbundled].map(name).sort().join(", ") || "none"}`,
    "  Call sites:",
    ...formatCallSites(result, root),
  );
  return lines;
}
