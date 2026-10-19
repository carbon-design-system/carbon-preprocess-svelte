import { $ } from "bun";

const dirs: string[] = [];
for await (const dir of $`find examples -maxdepth 1 -mindepth 1 -type d`.lines()) {
  if (dir) dirs.push(dir);
}
// The playground pins its dependencies the same way.
dirs.push("playground");

for (const dir of dirs) {
  // biome-ignore lint/performance/noAwaitInLoops: one install at a time
  await $`cd ${dir} && bun update && bun prune && bun dedupe`;
}
