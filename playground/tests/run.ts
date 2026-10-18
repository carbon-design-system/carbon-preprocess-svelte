// The playground's test pipeline, as CI runs it:
//
//   1. build carbon-preprocess-svelte and link it into the playground;
//   2. type-check the playground, then every example (fails on unexpected
//      errors);
//   3. build the playground (with the type errors, for the squiggles);
//   4. serve it, and run the browser tests (`*.browser.ts`) against it.
//
//   bun run test:playground            # from the repo root
//   PLAYGROUND_SKIP_SETUP=1 bun …      # reuse the last build and install
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { $ } from "bun";

const ROOT = path.join(import.meta.dirname, "../..");
// The installed carbon-components-svelte unless CCS_DIR is set here:
// `playground/.env.local` is for local development, not the tests.
process.env.CCS_DIR ??= "";
const HERE = path.join(import.meta.dirname, "..");

if (!process.env.PLAYGROUND_SKIP_SETUP) {
  console.log("Building and linking carbon-preprocess-svelte…");
  await $`bun run build && bun link`.cwd(ROOT).quiet();
  await $`bun link carbon-preprocess-svelte && bun install`.cwd(HERE).quiet();
  await $`rm -rf node_modules/.cache/carbon-preprocess-svelte`.cwd(HERE);
}

console.log("Type-checking the playground's own TypeScript…");
await $`node_modules/.bin/tsc -p tsconfig.json`.cwd(HERE);

console.log("Type-checking examples…");
await $`bun scripts/typecheck-examples.ts`.cwd(HERE);

console.log("Building the playground…");
await $`bunx vite build --logLevel error`.cwd(HERE).quiet();

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI color codes
const ANSI_COLOR = /\x1b\[[0-9;]*m/g;

// Serve the build, and read the URL Vite picked.
const server = spawn("bunx", ["vite", "preview", "--port", "4173"], {
  cwd: HERE,
});
const url = await new Promise<string>((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("vite preview didn't start")),
    30_000,
  );
  server.stdout.on("data", (chunk: Buffer) => {
    // Vite colors its output when `CI` is set: the port is wrapped in codes.
    const text = chunk.toString().replace(ANSI_COLOR, "");
    const found = /(http:\/\/localhost:\d+)/.exec(text);
    if (found) {
      clearTimeout(timer);
      resolve(found[1]);
    }
  });
});

const tests = readdirSync(import.meta.dirname)
  .filter((file) => file.endsWith(".browser.ts"))
  .map(
    (file) =>
      `./${path.relative(process.cwd(), path.join(import.meta.dirname, file))}`,
  );
const result = await $`bun test --timeout 60000 ${tests}`
  .env({ ...process.env, PLAYGROUND_URL: url })
  .nothrow();
server.kill();
process.exit(result.exitCode);
