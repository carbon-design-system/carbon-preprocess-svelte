import { optimizeCss, optimizeImports } from "carbon-preprocess-svelte";
import { defineConfig } from "rolldown";
import css from "rollup-plugin-css-only";
import svelte from "rollup-plugin-svelte";

const production = process.env.NODE_ENV === "production";

export default defineConfig({
  input: "src/index.ts",
  output: {
    dir: "public/build",
    format: "iife",
    name: "app",
    entryFileNames: "bundle.js",
    sourcemap: !production,
    minify: production,
  },
  resolve: { conditionNames: ["svelte", "browser", "import"] },
  // Rolldown's native CSS bundling was removed (rolldown/rolldown#4271); treat
  // .css imports as plain JS source so rollup-plugin-css-only's transform
  // hook can intercept them instead of Rolldown's built-in css handling.
  moduleTypes: { ".css": "js" },
  plugins: [
    svelte({
      preprocess: [optimizeImports()],
      compilerOptions: { dev: !production },
    }),
    css({ output: "bundle.css" }),
    // Only apply the plugin when building for production.
    production && optimizeCss(),
  ],
});
