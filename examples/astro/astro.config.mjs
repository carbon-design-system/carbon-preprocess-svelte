// @ts-check
import svelte from "@astrojs/svelte";
import { defineConfig } from "astro/config";
import { optimizeComponents, optimizeCss } from "carbon-preprocess-svelte";

// `OPTIMIZE=1` adds the experimental optimizations: `optimizeComponents`
// rewrites Carbon components for the props the app passes, and prop-aware
// `optimizeCss` prunes their unused styles. Built to `dist-optimized/`.
const optimize = process.env.OPTIMIZE === "1";

export default defineConfig({
  integrations: [svelte()],
  outDir: optimize ? "dist-optimized" : "dist",
  build: {
    // Keep CSS as a separate asset so the pruned output is visible.
    inlineStylesheets: "never",
  },
  vite: {
    plugins: [
      optimize && optimizeComponents(),
      optimizeCss({ experimental: { propAware: optimize } }),
    ],
  },
});
