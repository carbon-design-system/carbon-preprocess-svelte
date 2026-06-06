import { readFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const exampleDir = join(import.meta.dirname, "..");
const manifest = JSON.parse(
  readFileSync(join(exampleDir, "entries.manifest.json"), "utf-8"),
) as string[];

for (const entry of manifest) {
  console.log(`\nBuilding entry: ${entry}\n`);
  // biome-ignore lint/performance/noAwaitInLoops: sequential builds avoid dist races and keep logs readable
  await $`cd ${exampleDir} && ENTRY=${entry} vite build`;
}
