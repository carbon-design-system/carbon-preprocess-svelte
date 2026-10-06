import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import {
  optimizeComponents,
  optimizeCss,
  optimizeImports,
} from "carbon-preprocess-svelte";
import { defineConfig } from "vite";

/**
 * One build per optimization level, compared by `bun run build`:
 * - `baseline`: no CSS or component optimization
 * - `css`: `optimizeCss()`, pruning styles of components the app imports
 * - `prop-aware`: also prunes styles for props the app never passes
 * - `full`: also rewrites Carbon components for the props the app passes
 *
 * SvelteKit prerenders the page with the server build and hydrates it with
 * the client build; `optimizeComponents` rewrites Carbon the same way in both.
 */
const variant = process.env.VARIANT ?? "full";

export default defineConfig({
  plugins: [
    variant === "full" && optimizeComponents(),
    sveltekit({
      preprocess: [optimizeImports()],
      // One output directory per variant.
      adapter: adapter({
        pages: `build/${variant}`,
        assets: `build/${variant}`,
      }),
    }),
    variant !== "baseline" &&
      optimizeCss({
        propAware: variant !== "css",
      }),
  ],
  optimizeDeps: {
    exclude: [
      "carbon-components-svelte",
      "carbon-icons-svelte",
      "carbon-pictograms-svelte",
    ],
  },
});
