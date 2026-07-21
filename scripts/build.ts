import { watch } from "node:fs";
import { resolve } from "node:path";
import { $, build } from "bun";
import { bundleDts } from "./bundle-dts";

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
