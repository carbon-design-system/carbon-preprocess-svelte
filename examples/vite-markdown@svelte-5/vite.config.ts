import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import {
  markdown,
  optimizeCss,
  optimizeImports,
} from "carbon-preprocess-svelte";

/** @type {import('vite').UserConfig} */
export default {
  plugins: [
    svelte({
      // Compile `.md` files as components.
      extensions: [".svelte", ".md"],
      preprocess: [
        // Markdown first, so `optimizeImports` rewrites the imports it adds.
        markdown({
          layout: "/src/DocLayout.svelte",
          anchors: { depths: [2, 3] },
          codeSnippet: true,
        }),
        vitePreprocess(),
        optimizeImports(),
      ],
    }),
    optimizeCss(),
  ],
  resolve: {
    // A linked carbon-components-svelte (to try an unreleased Prose) brings
    // its own `svelte`; use the app's.
    dedupe: ["svelte"],
  },
  optimizeDeps: {
    exclude: [
      "carbon-components-svelte",
      "carbon-icons-svelte",
      "carbon-pictograms-svelte",
    ],
  },
};
