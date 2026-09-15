import { watch } from "node:fs";
import { chmod, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { $, build } from "bun";
import { bundleDts } from "./bundle-dts";

const STATIC_SVELTE_IMPORT = /\bfrom\s*["']svelte/;
const SHEBANG = "#!/usr/bin/env node\n";
const JS_FILE = /\.js$/;

const isWatchMode =
  process.argv.includes("-w") || process.argv.includes("--watch");
const root = process.cwd();

await $`rm -rf dist; mkdir dist`;

async function emitTypeDeclarations() {
  try {
    await bundleDts({
      root,
      source: resolve(root, "src/index.ts"),
      outFile: resolve(root, "dist/index.d.ts"),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    if (!isWatchMode) {
      process.exit(1);
    }
  }
}

async function buildProject() {
  const result = await build({
    entrypoints: ["./src/index.ts", "./src/cli.ts"],
    outdir: "./dist",
    format: "esm",
    target: "node",
    minify: true,
    splitting: true,
    // Every consumer already has svelte installed to run its own compiler,
    // so resolve it at runtime instead of bundling svelte/compiler (and its
    // acorn dependency) into dist.
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

  // `svelte/compiler` is loaded only through the live index's dynamic import
  // (see src/indexer/svelte-parser.ts). A static import would load it when
  // any consumer loads this package. Scan every emitted file because code
  // splitting can put the import in a shared chunk.
  const distFiles = await readdir("./dist");
  const jsFiles = distFiles.filter((file) => JS_FILE.test(file));
  const bundles = await Promise.all(
    jsFiles.map(async (file) => ({
      file,
      text: await readFile(resolve("./dist", file), "utf8"),
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
  const cliPath = resolve("./dist/cli.js");
  const cli = await readFile(cliPath, "utf8");
  await writeFile(cliPath, SHEBANG + cli);
  await chmod(cliPath, 0o755);

  await emitTypeDeclarations();
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
