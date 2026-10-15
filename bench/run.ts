import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `import.meta.resolve` names the suite files without executing them. Importing
// a suite runs its top-level setup (including the build-index phase breakdown).
const suites = [
  fileURLToPath(import.meta.resolve("./optimize-css.bench.ts")),
  fileURLToPath(import.meta.resolve("./optimize-imports.bench.ts")),
  fileURLToPath(import.meta.resolve("./build-index.bench.ts")),
];

const root = fileURLToPath(new URL("..", import.meta.url));
const result = spawnSync(
  "ostia",
  ["bench", ...suites, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PATH: `${path.join(root, "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
