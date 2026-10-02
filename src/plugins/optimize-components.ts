import { globSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { isCarbonSvelteImport, isScannableModule, stripQuery } from "../utils";
import { collectCarbonImports } from "./scan-imports";

export type OptimizeComponentsOptions = {
  /**
   * Glob patterns (relative to the Vite root) of every file that renders
   * Carbon components. They're analyzed before the build; a module outside
   * them that imports a Carbon component fails the build, since the
   * components were already rewritten without it.
   * @default ["src/**\/*.svelte"]
   */
  content?: string[];

  /**
   * Replace an `{#if}` whose only live branch is known with that branch
   * instead of keeping an `{#if true}` around it. Svelte 5 only: Svelte 3/4
   * render whitespace differently without the block. Saves under a point of
   * JS.
   * @default false
   */
  unwrap?: boolean;

  /**
   * Set to `true` to skip the per-build summary.
   * @default false
   */
  silent?: boolean;
};

const DEFAULT_CONTENT = ["src/**/*.svelte"];
const PATH_SEPARATOR = /[\\/]/;

/**
 * **Experimental.** Vite/Rollup plugin that rewrites each Carbon component
 * the app renders for the props it passes: values that never change become
 * literals, and branches that can't run go, along with the components only
 * they render. Pair it with `optimizeCss({ experimental: { propAware: true } })`,
 * which prunes the styles of the same branches.
 *
 * Runs on production builds only, before Svelte compiles. Rewritten
 * components have no source maps yet: devtools show the rewritten source.
 */
export const optimizeComponents = (
  options?: OptimizeComponentsOptions,
): Plugin => {
  let root = process.cwd();
  /** Rewritten sources by the real path of the Carbon file. */
  let sources = new Map<string, string>();
  /** Real paths of the files analyzed before the build. */
  const analyzed = new Set<string>();
  /** Modules that render Carbon but weren't analyzed. */
  const missed = new Set<string>();

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

      const files: Array<{ file: string; code: string }> = [];
      for (const file of globSync(options?.content ?? DEFAULT_CONTENT, {
        cwd: root,
        exclude: (file) => file.split(PATH_SEPARATOR).includes("node_modules"),
      })) {
        const absolute = path.resolve(root, file);
        try {
          files.push({ file: absolute, code: readFileSync(absolute, "utf8") });
        } catch {
          continue; // A directory, or gone since the glob ran.
        }
        analyzed.add(realpath(absolute) ?? absolute);
      }

      // Loaded lazily: builds without this plugin never evaluate the analyzer.
      const { specializeFiles } = await import("../analyzer");
      const result = await specializeFiles({
        projectRoot: root,
        files,
        options: { unwrap: options?.unwrap === true },
      });
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
      if (isCarbonSvelteImport(id) || !isScannableModule(id)) return;
      const file = stripQuery(id);
      if (analyzed.has(realpath(file) ?? file)) return;
      const imported = new Set<string>();
      collectCarbonImports(code, imported);
      if (imported.size > 0) missed.add(path.relative(root, file));
    },
    buildEnd() {
      if (missed.size === 0) return;
      this.error(
        `carbon-preprocess-svelte: optimizeComponents rewrote Carbon components before seeing ${[...missed].join(", ")}, which import(s) them. Add those files to \`content\` (now ${JSON.stringify(options?.content ?? DEFAULT_CONTENT)}).`,
      );
    },
  };
};
