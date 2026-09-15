// @ts-check
import svelte from "@astrojs/svelte";
import { defineConfig } from "astro/config";
import { optimizeCss } from "carbon-preprocess-svelte";

export default defineConfig({
  integrations: [svelte()],
  build: {
    // Keep CSS as a separate asset so the pruned output is visible.
    inlineStylesheets: "never",
  },
  vite: {
    plugins: [optimizeCss()],
  },
});
