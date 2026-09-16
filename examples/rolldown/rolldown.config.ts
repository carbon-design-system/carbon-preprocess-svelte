import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { optimizeCss, optimizeImports } from "carbon-preprocess-svelte";
import { defineConfig } from "rolldown";
import svelte from "rollup-plugin-svelte";

const production = process.env.NODE_ENV === "production";

// Minimal stand-in for rollup-plugin-css-only: collects the virtual `.css`
// modules that rollup-plugin-svelte emits (one per component, in import
// order) and writes them out as a single bundled stylesheet. Unlike
// rollup-plugin-css-only, this skips non-chunk bundle entries (e.g. the
// `.map` sourcemap asset) before calling `getModuleInfo`, since Rolldown's
// native binding throws on a non-string id instead of returning `null`.
const styles = new Map();
function collectCssImports(id, getModuleInfo, ids, visited = new Set()) {
  if (id == null || visited.has(id)) return;
  visited.add(id);
  if (styles.has(id)) ids.add(id);
  for (const importedId of getModuleInfo(id)?.importedIds ?? []) {
    collectCssImports(importedId, getModuleInfo, ids, visited);
  }
}
const emitCss = {
  name: "emit-css",
  transform(code, id) {
    if (!id.endsWith(".css")) return;
    styles.set(id, code);
    return "";
  },
  generateBundle(_opts, bundle) {
    const ids = new Set();
    for (const file of Object.values(bundle)) {
      if (file.type === "chunk") {
        collectCssImports(file.facadeModuleId, this.getModuleInfo, ids);
      }
    }
    const source = Array.from(ids)
      .map((id) => styles.get(id))
      .join("\n");
    // `name` (not `fileName`) is passed so output.assetFileNames controls
    // whether the emitted file is content-hashed.
    this.emitFile({ type: "asset", name: "bundle.css", source });
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
    const jsFile = Object.values(bundle).find(
      (file) => file.type === "chunk" && file.fileName.endsWith(".js"),
    );
    const html = readFileSync(htmlTemplatePath, "utf8")
      .replace("build/bundle.css", `build/${cssFile.fileName}`)
      .replace("build/bundle.js", `build/${jsFile.fileName}`);
    writeFileSync(htmlOutputPath, html);
  },
};

export default defineConfig({
  input: "src/index.ts",
  output: {
    dir: "public/build",
    format: "iife",
    name: "app",
    entryFileNames: production ? "bundle-[hash].js" : "bundle.js",
    assetFileNames: production ? "[name]-[hash][extname]" : "[name][extname]",
    sourcemap: !production,
    minify: production,
  },
  resolve: { conditionNames: ["svelte", "browser", "import"] },
  // Rolldown's native CSS bundling was removed (rolldown/rolldown#4271); treat
  // .css imports as plain JS source so emitCss's transform hook can
  // intercept them instead of Rolldown's built-in css handling.
  moduleTypes: { ".css": "js" },
  plugins: [
    svelte({
      preprocess: [optimizeImports()],
      compilerOptions: { dev: !production },
    }),
    emitCss,
    // Only apply the plugin when building for production.
    production && optimizeCss(),
    emitHtml,
  ],
});
