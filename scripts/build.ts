import { existsSync, watch } from "node:fs";
import { chmod, cp, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { $, build } from "bun";
import { bundleDts } from "./bundle-dts";

const STATIC_SVELTE_IMPORT = /\bfrom\s*["']svelte/;
const SHEBANG = "#!/usr/bin/env node\n";
const JS_FILE = /\.js$/;
const STRIP_PKG_FIELDS = new Set(["devDependencies", "scripts", "files"]);
const DIST_PREFIX = /^\.\/dist\//;

const isWatchMode =
  process.argv.includes("-w") || process.argv.includes("--watch");
const root = process.cwd();
const outDir = resolve(root, "dist");

await $`rm -rf ${outDir}; mkdir ${outDir}`;

// Copy assets over first, before any generated file lands in `dist/`, so a
// build failure never leaves a half-written manifest sitting next to missing
// assets. `package.json` gets slimmed in place afterward.
await Promise.all(
  ["README.md", "LICENSE", "package.json"].map(async (asset) => {
    const path = resolve(root, asset);
    if (existsSync(path)) {
      await cp(path, resolve(outDir, asset));
    }
  }),
);

async function emitTypeDeclarations() {
  try {
    await bundleDts({
      root,
      source: resolve(root, "src/index.ts"),
      outFile: resolve(outDir, "index.d.ts"),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    if (!isWatchMode) {
      process.exit(1);
    }
  }
}

async function slimPackageManifest() {
  const manifestPath = resolve(outDir, "package.json");
  const pkg = await Bun.file(manifestPath).json();

  for (const key of STRIP_PKG_FIELDS) {
    delete pkg[key];
  }

  pkg.main = pkg.main.replace(DIST_PREFIX, "./");
  pkg.types = pkg.types.replace(DIST_PREFIX, "./");
  for (const [name, path] of Object.entries(
    pkg.bin as Record<string, string>,
  )) {
    pkg.bin[name] = path.replace(DIST_PREFIX, "");
  }
  // Constructed directly from the slimmed main/types above rather than
  // rewritten from a root `exports` field, so root package.json doesn't
  // need to carry a duplicate (and easily-drifting) copy of this map.
  const exports = {
    ".": { types: pkg.types, import: pkg.main, default: pkg.main },
  };

  // A new key always appends at the end of JS object order, so rebuild the
  // manifest to place `exports` right after `types` instead of last.
  const ordered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(pkg)) {
    ordered[key] = value;
    if (key === "types") ordered.exports = exports;
  }

  await writeFile(manifestPath, `${JSON.stringify(ordered, null, 2)}\n`);
}

async function buildProject() {
  const result = await build({
    entrypoints: ["./src/index.ts", "./src/cli.ts"],
    outdir: outDir,
    format: "esm",
    target: "node",
    minify: true,
    splitting: true,
    // Every consumer already has svelte installed to run its own compiler,
    // so resolve it at runtime instead of bundling svelte/compiler (and its
    // acorn dependency) into dist/.
    external: ["svelte", "svelte/*"],
  });

  if (!result.success) {
    console.error("Build failed");
    for (const log of result.logs) {
      console.error(log);
    }
    if (!isWatchMode) {
      process.exit(1);
    }
    return;
  }

  // `svelte/compiler` is loaded only through the component index's dynamic import
  // (see src/indexer/svelte-parser.ts). A static import would load it when
  // any consumer loads this package. Scan every emitted file because code
  // splitting can put the import in a shared chunk.
  const outFiles = await readdir(outDir);
  const jsFiles = outFiles.filter((file) => JS_FILE.test(file));
  const bundles = await Promise.all(
    jsFiles.map(async (file) => ({
      file,
      text: await readFile(resolve(outDir, file), "utf8"),
    })),
  );
  const offender = bundles.find(({ text }) => STATIC_SVELTE_IMPORT.test(text));
  if (offender) {
    console.error(
      `Build failed: dist/${offender.file} statically imports svelte. Import it lazily via loadSvelteParser() instead.`,
    );
    if (!isWatchMode) {
      process.exit(1);
    }
    return;
  }

  // `src/cli.ts` has no shebang so tests can import it as a module.
  // The published binary gets one here.
  const cliPath = resolve(outDir, "cli.js");
  const cli = await readFile(cliPath, "utf8");
  await writeFile(cliPath, SHEBANG + cli);
  await chmod(cliPath, 0o755);

  await emitTypeDeclarations();
  await slimPackageManifest();
  console.log("✓ Build completed");
}

if (isWatchMode) {
  console.log("Watching for changes...\n");

  await buildProject();

  let debounceTimer: Timer | null = null;
  let isBuilding = false;

  const watcher = watch(
    "./src",
    { recursive: true },
    (_eventType, filename) => {
      if (filename && !isBuilding) {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(async () => {
          console.log(`\nFile changed: ${filename}`);
          isBuilding = true;
          await buildProject();
          isBuilding = false;
        }, 100);
      }
    },
  );

  setInterval(() => {}, 1000);

  process.on("SIGINT", () => {
    console.log("\nStopping watch mode...");
    watcher.close();
    process.exit(0);
  });
} else {
  await buildProject();
}
