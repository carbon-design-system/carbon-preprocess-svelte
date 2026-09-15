import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import { optimizeCss, optimizeImports } from "carbon-preprocess-svelte";
import css from "rollup-plugin-css-only";
import svelte from "rollup-plugin-svelte";
import { terser } from "rollup-plugin-terser";

const production = !process.env.ROLLUP_WATCH;

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

export default {
  input: "src/index.ts",
  output: {
    sourcemap: !production,
    format: "iife",
    name: "app",
    file: "public/build/bundle.js",
    // `fileName` is left unset on the css plugin below (only `name` is
    // given), so it emits the asset by name rather than a fixed fileName,
    // letting assetFileNames control whether the CSS file is content-hashed.
    assetFileNames: production ? "[name]-[hash][extname]" : "[name][extname]",
    inlineDynamicImports: true,
  },
  plugins: [
    svelte({
      preprocess: [optimizeImports()],
      compilerOptions: { dev: !production },
    }),
    resolve({ browser: true, dedupe: ["svelte"] }),
    commonjs(),
    css({ name: "bundle.css" }),
    production && terser(),
    production && optimizeCss(),
    emitHtml,
  ],
};
