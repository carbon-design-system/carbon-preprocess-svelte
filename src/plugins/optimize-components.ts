import { createHash } from "node:crypto";
import { globSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import type { SpecializedComponents } from "../analyzer";
import { CarbonSvelte, RE_EXT_STYLESHEET } from "../constants";
import { installedMajor } from "../indexer/resolve-carbon-root";
import { isCarbonSvelteImport, stripQuery } from "../utils";
import { collectCarbonImports } from "./scan-imports";

export type OptimizeComponentsOptions = {
  /**
   * Glob patterns (relative to the Vite root) of every file that renders
   * Carbon components. They're analyzed before the build; a module outside
   * them that imports a Carbon component fails the build, since the
   * components were already rewritten without it.
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

/**
 * **Experimental.** Vite, Rollup and Rolldown plugin that rewrites each Carbon component
 * the app renders for the props it passes: values that never change become
 * literals, and branches that can't run go, along with the components only
 * they render. Pair it with `optimizeCss({ experimental: { propAware: true } })`,
 * which prunes the styles of the same branches.
 *
 * Runs on production builds only, before Svelte compiles. Rewritten
 * components come with source maps back to Carbon's source.
 */
export const optimizeComponents = (
  options?: OptimizeComponentsOptions,
): Plugin => {
  let root = process.cwd();
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

  const realpath = (file: string): string | undefined => {
    try {
      return realpathSync(file);
    } catch {
      return undefined;
    }
  };

  return {
    name: "vite:carbon:optimize-components",
    apply: "build",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      sources = new Map();
      analyzed.clear();
      missed.clear();
      virtual.clear();

      const files: Array<{ file: string; code: string }> = [];
      const hash = createHash("sha1");
      for (const file of globContent(
        options?.content ?? DEFAULT_CONTENT,
        root,
      )) {
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
      if ("warning" in result) {
        this.warn(result.warning);
        return;
      }
      sources = result.sources;
      if (!options?.silent) {
        this.info?.(
          `rewrote ${sources.size} Carbon components for this app (${result.edits} edits)`,
        );
      }
    },
    load(id) {
      if (sources.size === 0) return;
      // Svelte's style sub-modules (`?svelte&type=style`) aren't the source.
      const [file, query = ""] = id.split("?");
      if (query.includes("svelte")) return;
      const real = realpath(file);
      return real ? sources.get(real) : undefined;
    },
    transform(code, id) {
      if (sources.size === 0) return;
      const file = stripQuery(id);
      if (isCarbonSvelteImport(file) || RE_EXT_STYLESHEET.test(file)) return;
      if (analyzed.has(realpath(file) ?? file)) return;
      if (!importsCarbon(file, code)) return;
      if (id.startsWith("\0") || !path.isAbsolute(file)) virtual.add(id);
      else missed.add(path.relative(root, file));
    },
    buildEnd() {
      const errors: string[] = [];
      if (missed.size > 0) {
        errors.push(
          `optimizeComponents rewrote Carbon components before seeing ${[...missed].join(", ")}, which import(s) them. Add those files to \`content\` (now ${JSON.stringify(options?.content ?? DEFAULT_CONTENT)}); only a pattern that names \`node_modules\` reaches inside it.`,
        );
      }
      if (virtual.size > 0) {
        errors.push(
          `optimizeComponents can't analyze ${[...virtual].join(", ")}, which import(s) Carbon components but has no file on disk. Import them from a file in \`content\` instead, or remove optimizeComponents.`,
        );
      }
      if (errors.length > 0) {
        this.error(`carbon-preprocess-svelte: ${errors.join(" ")}`);
      }
    },
  };
};
