import { $ } from "bun";
import { name } from "../package.json";

await $`bun run build && bun link`;

for await (const dir of $`find examples -maxdepth 1 -mindepth 1 -type d`.lines()) {
  await $`cd ${dir} && bun link ${name}`;
  await $`cd ${dir} && bun install`;
  await $`cd ${dir} && bun run build`;
}
