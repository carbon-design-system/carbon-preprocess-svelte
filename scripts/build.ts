import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { $, build } from "bun";
import { bundleDts } from "./bundle-dts";

const STATIC_SVELTE_IMPORT = /\bfrom\s*["']svelte/;

const isWatchMode =
  process.argv.includes("-w") || process.argv.includes("--watch");
const root = process.cwd();

await $`rm -rf dist; mkdir dist`;

async function emitTypeDeclarations() {
  try {
    await bundleDts({
      root,
      source: resolve(root, "src/index.ts"),
      ambientRoots: [resolve(root, "src/global.d.ts")],
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
    entrypoints: ["./src/index.ts"],
    outdir: "./dist",
    format: "esm",
    target: "node",
    minify: true,
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

  // `svelte/compiler` must only ever be reached through the live index's
  // dynamic import (see src/indexer/svelte-parser.ts). A static import here
  // would make every consumer pay for it at module load.
  const bundle = await readFile("./dist/index.js", "utf8");
  if (STATIC_SVELTE_IMPORT.test(bundle)) {
    console.error(
      "Build failed: dist/index.js statically imports svelte. Import it lazily via loadSvelteParser() instead.",
    );
    if (!isWatchMode) {
      process.exit(1);
    }
    return;
  }

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
