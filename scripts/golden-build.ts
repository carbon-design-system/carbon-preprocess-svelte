/**
 * Builds a golden app (`golden/<name>`) with Vite and this package's own
 * plugins, one variant at a time, for `eval-interactions.ts`:
 *
 * - `baseline`: no optimization.
 * - `css`: `optimizeCss()`.
 * - `prop-aware`: `optimizeCss({ propAware: true })`.
 * - `full`: that plus `optimizeComponents()`.
 *
 * Svelte is compiled by a minimal plugin rather than
 * `@sveltejs/vite-plugin-svelte`, with this repo's Svelte 5 and, like the
 * examples, `optimizeImports` (barrel imports to direct paths): component
 * styles are injected, which is all an interaction check needs.
 */
import path from "node:path";
import { compile, compileModule, preprocess } from "svelte/compiler";
import { build, defaultClientConditions, type Plugin } from "vite";
import { optimizeComponents, optimizeCss, optimizeImports } from "../src";

export const GOLDEN_VARIANTS = ["baseline", "css", "prop-aware", "full"];

const SVELTE_FILE = /\.svelte$/;
const SVELTE_MODULE = /\.svelte\.[jt]s$/;

function svelte(): Plugin {
  return {
    name: "golden:svelte",
    async transform(code, id) {
      const file = id.split("?")[0];
      if (SVELTE_FILE.test(file)) {
        // Carbon's own components need no rewriting.
        const source = file.includes(`${path.sep}node_modules${path.sep}`)
          ? code
          : (await preprocess(code, [optimizeImports()], { filename: file }))
              .code;
        const { js } = compile(source, {
          filename: file,
          generate: "client",
          css: "injected",
        });
        return { code: js.code, map: js.map };
      }
      // Vite has already stripped the TypeScript of `cart.svelte.ts`.
      if (SVELTE_MODULE.test(file)) {
        const { js } = compileModule(code, {
          filename: file,
          generate: "client",
        });
        return { code: js.code, map: js.map };
      }
      return undefined;
    },
  };
}

/** Builds `golden/<name>` as `variant` into `outDir`. */
export async function buildGolden(
  appDir: string,
  variant: string,
  outDir: string,
): Promise<void> {
  const plugins: Plugin[] = [];
  if (variant === "full") plugins.push(optimizeComponents({ silent: true }));
  plugins.push(svelte());
  if (variant !== "baseline") {
    plugins.push(
      optimizeCss({
        propAware: variant === "prop-aware" || variant === "full",
      }),
    );
  }
  await build({
    root: appDir,
    configFile: false,
    logLevel: "silent",
    mode: "production",
    resolve: {
      conditions: ["svelte", ...defaultClientConditions],
      dedupe: ["svelte"],
    },
    plugins,
    build: { outDir: path.resolve(outDir), emptyOutDir: true },
  });
}
