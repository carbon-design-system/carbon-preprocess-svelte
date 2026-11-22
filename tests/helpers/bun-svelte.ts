import { compile, compileModule, preprocess } from "svelte/compiler";
import type { BunPlugin } from "bun";
import {
  type CarbonBunPlugin,
  optimizeImports,
} from "carbon-preprocess-svelte";

const SVELTE_FILE = /\.svelte$/;
const SVELTE_MODULE = /\.svelte\.ts$/;
const NODE_MODULES = /[\\/]node_modules[\\/]/;

/**
 * Compiles `.svelte` files for `Bun.build`, with their styles injected,
 * from what `carbon.load` returns: the Svelte plugin an app using
 * `optimizeCarbonBun` writes.
 */
export function bunSvelte(carbon?: CarbonBunPlugin): BunPlugin {
  return {
    name: "test:svelte",
    setup(build) {
      build.onLoad({ filter: SVELTE_FILE }, async ({ path }) => {
        let source = carbon?.load(path)?.code ?? (await Bun.file(path).text());
        if (!NODE_MODULES.test(path)) {
          source = (
            await preprocess(source, [optimizeImports()], { filename: path })
          ).code;
        }
        const { js } = compile(source, {
          filename: path,
          generate: "client",
          css: "injected",
        });
        return { contents: js.code, loader: "js" };
      });
      build.onLoad({ filter: SVELTE_MODULE }, async ({ path }) => {
        const ts = new Bun.Transpiler({ loader: "ts" });
        const code = ts.transformSync(await Bun.file(path).text());
        const { js } = compileModule(code, {
          filename: path,
          generate: "client",
        });
        return { contents: js.code, loader: "js" };
      });
    },
  };
}
