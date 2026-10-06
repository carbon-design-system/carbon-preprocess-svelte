import { createHash } from "node:crypto";
import { globSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { SpecializedComponents } from "../analyzer";
import { CarbonSvelte, LOG_PREFIX, RE_EXT_STYLESHEET } from "../constants";
import { installedMajor } from "../indexer/resolve-carbon-root";
import { isCarbonSvelteImport, stripQuery } from "../utils";
import { collectCarbonImports } from "./scan-imports";

export type OptimizeComponentsOptions = {
  /**
   * Glob patterns (relative to the project root) of every file that
   * renders Carbon components. They're analyzed before the build; a module
   * outside them that imports a Carbon component fails the build, since
   * the components were already rewritten without it.
   *
   * `.svelte` files are read for the props they pass. Every Carbon
   * component a script, Markdown, MDX or Astro file imports keeps every
   * prop value. `node_modules` is skipped unless a pattern names it.
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
/** Files whose imports `collectCarbonImports` can lex. */
const LEXABLE = /\.(svelte|[cm]?[jt]sx?)$/;

const isInNodeModules = (file: string) =>
  file.split(PATH_SEPARATOR).includes("node_modules");

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

/** Whether module `code` imports a Carbon component. */
function importsCarbon(file: string, code: string): boolean {
  if (!LEXABLE.test(file)) return code.includes(CarbonSvelte.Components);
  const imported = new Set<string>();
  collectCarbonImports(code, imported);
  return imported.size > 0;
}

function realpath(file: string): string | undefined {
  try {
    return realpathSync(file);
  } catch {
    return undefined;
  }
}

/** A rewritten Carbon component, as a bundler's `load` returns it. */
export type RewrittenSource =
  SpecializedComponents["sources"] extends Map<string, infer Source>
    ? Source
    : never;

/**
 * What `optimizeComponents` and `OptimizeComponentsPlugin` share: analyze
 * `content` before a build, serve the rewritten Carbon sources, and check
 * that no module outside `content` renders Carbon.
 */
export function createComponentOptimizer(
  options: OptimizeComponentsOptions | undefined,
  /** Names the plugin in messages. */
  name: string,
) {
  const content = options?.content ?? DEFAULT_CONTENT;
  /** Rewritten sources by the real path of the Carbon file. */
  let sources: SpecializedComponents["sources"] = new Map();
  /** Real paths of the files analyzed before the build. */
  const analyzed = new Set<string>();
  /** Files that render Carbon but weren't analyzed. */
  const missed = new Set<string>();
  /** Modules with no file that render Carbon: never analyzable. */
  const virtual = new Set<string>();
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

  return {
    /** Analyzes `content` under `root`; call before each build. */
    async prepare(
      root: string,
    ): Promise<{ warning?: string; info?: string; report?: string[] }> {
      sources = new Map();
      analyzed.clear();
      missed.clear();
      virtual.clear();

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
        analyzed.add(realpath(absolute) ?? absolute);
      }

      const digest = hash.digest("hex");
      if (last?.hash !== digest) {
        // Loaded lazily: builds without this plugin never evaluate the analyzer.
        const { specializeFiles } = await import("../analyzer");
        last = {
          hash: digest,
          result: await specializeFiles({
            projectRoot: root,
            files,
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
      return {
        info: options?.silent
          ? undefined
          : `rewrote ${sources.size} Carbon components for this app (${result.edits} edits)`,
        report: options?.report ? result.report() : undefined,
      };
    },

    /** The files `prepare` analyzed. */
    get analyzed(): ReadonlySet<string> {
      return analyzed;
    },

    /** The rewritten source of module `id`, if it's a rewritten Carbon component. */
    load(id: string): RewrittenSource | undefined {
      if (sources.size === 0) return undefined;
      // Svelte's style sub-modules (`?svelte&type=style`) aren't the source.
      const [file, query = ""] = id.split("?");
      if (query.includes("svelte")) return undefined;
      const real = realpath(file);
      return real ? sources.get(real) : undefined;
    },

    /** Records module `id` if it renders Carbon without having been analyzed. */
    check(id: string, code: string, root: string): void {
      if (sources.size === 0) return;
      const file = stripQuery(id);
      if (isCarbonSvelteImport(file) || RE_EXT_STYLESHEET.test(file)) return;
      const real = realpath(file);
      if (analyzed.has(real ?? file)) return;
      if (!importsCarbon(file, code)) return;
      if (id.startsWith("\0") || !path.isAbsolute(file)) virtual.add(id);
      else {
        const base = real ? (realpath(root) ?? root) : root;
        missed.add(path.relative(base, real ?? file));
      }
    },

    /** The build error for the modules `check` recorded, if any. */
    error(): string | undefined {
      const errors: string[] = [];
      if (missed.size > 0) {
        errors.push(
          `${name} rewrote Carbon components before seeing ${[...missed].join(", ")}, which import(s) them. Add those files to \`content\` (now ${JSON.stringify(content)}); only a pattern that names \`node_modules\` reaches inside it.`,
        );
      }
      if (virtual.size > 0) {
        errors.push(
          `${name} can't analyze ${[...virtual].join(", ")}, which import(s) Carbon components but has no file on disk. Import them from a file in \`content\` instead, or remove ${name}.`,
        );
      }
      return errors.length > 0
        ? `${LOG_PREFIX} ${errors.join(" ")}`
        : undefined;
    },
  };
}

export type ComponentOptimizer = ReturnType<typeof createComponentOptimizer>;
