import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { optimizeCss, optimizeImports } from "carbon-preprocess-svelte";
import { defineConfig } from "rolldown";
import css from "rollup-plugin-css-only";
import svelte from "rollup-plugin-svelte";

const production = process.env.NODE_ENV === "production";

// rollup-plugin-css-only walks every `bundle` entry's `facadeModuleId` and
// passes it straight to `getModuleInfo`, relying on Rollup returning `null`
// for bogus ids (e.g. the `.map` sourcemap asset, which has no
// facadeModuleId). Rolldown's native binding throws instead of returning
// null for a non-string id, so filter the bundle down to chunks before
// calling into the plugin.
//
// `fileName` is left unset (only `name` given) so the plugin emits the
// asset by name rather than a fixed `fileName`, letting `output.assetFileNames`
// (below) control whether the CSS file is content-hashed.
const cssPlugin = css({ name: "bundle.css" });
const rolldownSafeCssPlugin = {
  ...cssPlugin,
  generateBundle(opts, bundle) {
    const chunksOnly = Object.fromEntries(
      Object.entries(bundle).filter(([, output]) => output.type === "chunk"),
    );
    return cssPlugin.generateBundle.call(this, opts, chunksOnly);
  },
};

// index.html is a template, not the served file: `public/` (the served
// output dir) is gitignored, so rewrite the template's asset links with the
// real (possibly hashed) build filenames on every build.
const htmlTemplatePath = fileURLToPath(
  new URL("./index.html", import.meta.url),
);
const htmlOutputPath = fileURLToPath(
  new URL("./public/index.html", import.meta.url),
);
const emitHtml = {
  name: "emit-html",
  writeBundle(_opts, bundle) {
    const cssFile = Object.values(bundle).find(
      (file) => file.type === "asset" && file.fileName.endsWith(".css"),
    );
    const html = readFileSync(htmlTemplatePath, "utf8").replace(
      "build/bundle.css",
      `build/${cssFile.fileName}`,
    );
    writeFileSync(htmlOutputPath, html);
  },
};

export default defineConfig({
  input: "src/index.ts",
  output: {
    dir: "public/build",
    format: "iife",
    name: "app",
    entryFileNames: "bundle.js",
    assetFileNames: production ? "[name]-[hash][extname]" : "[name][extname]",
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
    rolldownSafeCssPlugin,
    // Only apply the plugin when building for production.
    production && optimizeCss(),
    emitHtml,
  ],
});
