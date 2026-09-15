import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dirname, "../src/cli.ts");

/**
 * Temp project with one Svelte file that imports `Button`, plus a CSS file
 * that has `.bx--btn` (kept) and `.bx--accordion` (dropped).
 */
function createTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "cps-cli-"));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "dist"));
  writeFileSync(
    join(dir, "src", "App.svelte"),
    '<script>\n  import { Button } from "carbon-components-svelte";\n</script>\n<Button />\n',
  );
  writeFileSync(
    join(dir, "dist", "app.css"),
    ".bx--btn{color:red}\n.bx--accordion{color:blue}\n",
  );
  return dir;
}

function runCli(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [CLI_PATH, "optimize-css", ...args], {
    cwd,
    encoding: "utf8",
  });
}

describe("cli optimize-css", () => {
  test("rewrites the CSS file in place, keeping only used classes", () => {
    const dir = createTempProject();
    try {
      const result = runCli(dir, ["dist/app.css"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Optimized dist/app.css");

      const css = readFileSync(join(dir, "dist", "app.css"), "utf-8");
      expect(css).toContain(".bx--btn");
      expect(css).not.toContain(".bx--accordion");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--dry-run leaves the file unchanged and logs the dry-run message", () => {
    const dir = createTempProject();
    try {
      const result = runCli(dir, ["dist/app.css", "--dry-run"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Dry run: dist/app.css left unchanged");

      const css = readFileSync(join(dir, "dist", "app.css"), "utf-8");
      expect(css).toBe(".bx--btn{color:red}\n.bx--accordion{color:blue}\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("exits 1 with a stderr message when no CSS file matches", () => {
    const dir = createTempProject();
    try {
      const result = runCli(dir, ["dist/nope.css"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "carbon-preprocess-svelte: no CSS files matched",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("exits 1 when --content finds no imports, succeeds with --components", () => {
    const dir = createTempProject();
    try {
      const noImports = runCli(dir, [
        "dist/app.css",
        "--content",
        "nothing/**",
      ]);
      expect(noImports.status).toBe(1);
      expect(noImports.stderr).toContain(
        "carbon-preprocess-svelte: no carbon-components-svelte imports found in",
      );

      const withComponents = runCli(dir, [
        "dist/app.css",
        "--content",
        "nothing/**",
        "--components",
        "Button",
      ]);
      expect(withComponents.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--report prints the detected components summary", () => {
    const dir = createTempProject();
    try {
      const result = runCli(dir, ["dist/app.css", "--report"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Detected components (1): Button");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--safelist keeps a class that would otherwise be pruned", () => {
    const dir = createTempProject();
    try {
      const result = runCli(dir, [
        "dist/app.css",
        "--safelist",
        "/^\\.bx--accordion/",
      ]);
      expect(result.status).toBe(0);

      const css = readFileSync(join(dir, "dist", "app.css"), "utf-8");
      expect(css).toContain(".bx--accordion");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
