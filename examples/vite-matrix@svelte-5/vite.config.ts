import { svelte } from "@sveltejs/vite-plugin-svelte";
import {
  optimizeComponents,
  optimizeCss,
  optimizeImports,
} from "carbon-preprocess-svelte";

/**
 * One build per optimization level, compared by `bun run build`:
 * - `baseline`: no CSS or component optimization
 * - `css`: `optimizeCss()`, pruning styles of components the app doesn't
 *   render, and of props it never passes
 * - `full`: also rewrites Carbon components for the props the app passes
 * - `client-only`: `full` without Svelte's hydration code
 *   (`hydration: false`), since this app only mounts
 */
const variant = process.env.VARIANT ?? "full";

/** @type {import('vite').UserConfig} */
export default {
  build: {
    outDir: `dist/${variant}`,
    emptyOutDir: true,
  },
  plugins: [
    variant === "full" && optimizeComponents(),
    variant === "client-only" && optimizeComponents({ hydration: false }),
    svelte({ preprocess: [optimizeImports()] }),
    variant !== "baseline" && optimizeCss(),
  ],
  resolve: {
    conditions: ["browser"],
  },
  optimizeDeps: {
    exclude: [
      "carbon-components-svelte",
      "carbon-icons-svelte",
      "carbon-pictograms-svelte",
    ],
  },
};
