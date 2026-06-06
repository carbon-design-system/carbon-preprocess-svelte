import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { optimizeCss, optimizeImports } from "carbon-preprocess-svelte";

const dir = fileURLToPath(new URL(".", import.meta.url));
const entry = process.env.ENTRY ?? "datatable-toolbar";

/** @type {import('vite').UserConfig} */
export default {
  root: resolve(dir, "entries", entry),
  build: {
    outDir: resolve(dir, "dist", entry),
    emptyOutDir: true,
  },
  resolve: {
    conditions: ["browser"],
  },
  plugins: [
    svelte({
      preprocess: [vitePreprocess(), optimizeImports()],
    }),
    optimizeCss({ experimental: { strict: true } }),
  ],
  optimizeDeps: {
    exclude: [
      "carbon-components-svelte",
      "carbon-icons-svelte",
      "carbon-pictograms-svelte",
    ],
  },
};
