import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { optimizeCss, optimizeImports } from "carbon-preprocess-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    // SvelteKit 3 takes its options here; there's no svelte.config.js.
    sveltekit({
      preprocess: [vitePreprocess(), optimizeImports()],
      adapter: adapter(),
    }),
    optimizeCss(),
  ],

  // Optional, but recommended for even faster cold starts.
  // Instruct Vite to exclude packages that `optimizeImports` will resolve.
  optimizeDeps: {
    exclude: [
      "carbon-components-svelte",
      "carbon-icons-svelte",
      "carbon-pictograms-svelte",
    ],
  },
});
