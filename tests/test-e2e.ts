import { $, Glob } from "bun";
import { name } from "../package.json";

await $`bun run build && bun link`;

const dirs = new Glob("*").scanSync({
  cwd: "examples",
  onlyFiles: false,
  absolute: true,
});

for await (const dir of dirs) {
  await $`cd ${dir} && bun link ${name}`;
  await $`cd ${dir} && bun install`;
  await $`cd ${dir} && bun run build`;
}
