import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { optimizeCss, optimizeImports } from "carbon-preprocess-svelte";

/** @type {import('vite').UserConfig} */
export default {
  resolve: {
    conditions: ["browser"],
  },
  plugins: [
    svelte({
      preprocess: [vitePreprocess(), optimizeImports()],
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
};
