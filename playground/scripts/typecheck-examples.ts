// Type-checks every live and framed example, as the code views show it (the
// JSDoc and TypeScript views), with svelte-check against carbon-components-
// svelte's types. Writes `.typecheck/diagnostics.json`, which code views show
// as squiggles; exits 1 on an error that `expected-type-errors.json` doesn't
// list. Errors in a CCS checkout's own docs (`CCS_DIR`) are reported, not
// failed: they're CCS's to fix.
//
//   bun scripts/typecheck-examples.ts [--strict]
//
// It builds the playground first: the renderers write each view to
// `.typecheck/examples/`, so the examples checked are exactly the pages'.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const HERE = path.join(import.meta.dirname, "..");
const CHECK_DIR = path.join(HERE, ".typecheck");
const EXAMPLES = path.join(CHECK_DIR, "examples");
const SVELTE_CHECK = path.join(HERE, "node_modules/.bin/svelte-check");

// `--strict` adds TypeScript's strict checks (implicit any, possible null).
const strict = process.argv.includes("--strict");

type Expected = {
  origin: string;
  code: number;
  includes: string;
  reason: string;
};
const expected: Expected[] = JSON.parse(
  readFileSync(path.join(HERE, "expected-type-errors.json"), "utf8"),
);

// Fresh examples: build the playground, which writes them.
rmSync(EXAMPLES, { recursive: true, force: true });
const build = spawnSync(
  "bunx",
  [
    "vite",
    "build",
    "--outDir",
    path.join(CHECK_DIR, "build"),
    "--emptyOutDir",
    "--logLevel",
    "error",
  ],
  {
    cwd: HERE,
    stdio: ["ignore", "ignore", "inherit"],
  },
);
if (build.status !== 0) process.exit(build.status ?? 1);

const files = readdirSync(EXAMPLES).filter((f) => f.endsWith(".svelte"));
const origins: Record<string, string> = JSON.parse(
  readFileSync(path.join(CHECK_DIR, "origins.json"), "utf8"),
);
writeFileSync(
  path.join(CHECK_DIR, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        strict,
        allowJs: true,
        checkJs: true,
        noEmit: true,
        skipLibCheck: true,
        verbatimModuleSyntax: true,
        types: [],
      },
      include: ["examples/*.svelte", "ambient.d.ts"],
    },
    null,
    2,
  ),
);
// SvelteKit's modules, for examples written for SvelteKit.
writeFileSync(
  path.join(CHECK_DIR, "ambient.d.ts"),
  `declare module "$app/forms" {
  export const enhance: (form: HTMLFormElement, submit?: (input: any) => any) => { destroy(): void };
  export function applyAction(result: unknown): Promise<void>;
}
declare module "$app/navigation" {
  export function goto(url: string | URL, options?: object): Promise<void>;
}
declare module "$app/stores" {
  export const page: import("svelte/store").Readable<{ url: URL; params: Record<string, string> }>;
}
`,
);
if (!existsSync(SVELTE_CHECK)) {
  console.error(
    "svelte-check isn't installed: run `bun install` in playground/.",
  );
  process.exit(1);
}
const check = spawnSync(
  SVELTE_CHECK,
  [
    "--workspace",
    CHECK_DIR,
    "--tsconfig",
    path.join(CHECK_DIR, "tsconfig.json"),
    "--output",
    "machine-verbose",
  ],
  {
    cwd: CHECK_DIR,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  },
);

type Entry = {
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  message: string;
  code?: number;
  severity: "error" | "warning";
};
const diagnostics: Record<string, Entry[]> = {};
for (const line of check.stdout.split("\n")) {
  const json = line.slice(line.indexOf(" ") + 1);
  if (!json.startsWith("{")) continue;
  const d = JSON.parse(json);
  if (d.type !== "ERROR" && d.type !== "WARNING") continue;
  const name = path.basename(d.filename);
  if (!diagnostics[name]) diagnostics[name] = [];
  diagnostics[name].push({
    line: d.start.line,
    character: d.start.character,
    endLine: d.end.line,
    endCharacter: d.end.character,
    message: d.message,
    code: typeof d.code === "number" ? d.code : undefined,
    severity: d.type === "ERROR" ? "error" : "warning",
  });
}
writeFileSync(
  path.join(CHECK_DIR, "diagnostics.json"),
  JSON.stringify(diagnostics, null, 1),
);

const errors = Object.entries(diagnostics).flatMap(([file, list]) =>
  list
    .filter((d) => d.severity === "error")
    .map((d) => ({ file, origin: origins[file] ?? "?", ...d })),
);
const isExpected = (e: (typeof errors)[number]) =>
  expected.some(
    (x) =>
      e.origin === x.origin &&
      e.code === x.code &&
      e.message.includes(x.includes),
  );
const unexpected = errors.filter(
  (e) => !isExpected(e) && !e.origin.startsWith("ccs:"),
);
const ccs = errors.filter((e) => e.origin.startsWith("ccs:"));

const views = (suffix: string) =>
  files.filter((f) => f.endsWith(suffix)).length;
console.log(
  `Checked ${files.length} views${strict ? " (strict)" : ""} (${views(".ts.svelte")} TypeScript, ${views(".js.svelte")} JSDoc): ${errors.length} errors (${errors.length - unexpected.length - ccs.length} expected, ${ccs.length} in CCS docs, ${unexpected.length} unexpected).`,
);
const show = (list: typeof errors) => {
  for (const e of list.slice(0, 30)) {
    const source =
      readFileSync(path.join(EXAMPLES, e.file), "utf8").split("\n")[e.line] ??
      "";
    console.log(
      `\n${e.origin} (${e.file}:${e.line + 1}:${e.character + 1})  TS${e.code}  ${e.message.split("\n")[0]}\n    ${source.trim()}`,
    );
  }
  if (list.length > 30) console.log(`\n…and ${list.length - 30} more.`);
};
if (ccs.length) {
  console.log("\nIn the CCS checkout's docs (reported, not failed):");
  show(ccs);
}
if (unexpected.length) {
  console.log("\nUnexpected:");
  show(unexpected);
}
process.exit(unexpected.length > 0 ? 1 : 0);
