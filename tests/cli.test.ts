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
import { createFakeProject } from "./helpers/fake-project";

const KIND_TERTIARY = /kind\s+"tertiary"/;

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
      expect(result.stdout).toContain(
        "carbon-preprocess-svelte: pruned Carbon CSS\n  dist/app.css ",
      );

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
      expect(result.stdout).toContain(
        "carbon-preprocess-svelte: dry run, files unchanged: would prune Carbon CSS\n  dist/app.css ",
      );

      const css = readFileSync(join(dir, "dist", "app.css"), "utf-8");
      expect(css).toBe(".bx--btn{color:red}\n.bx--accordion{color:blue}\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("exits 2 with a stderr message when no CSS file matches", () => {
    const dir = createTempProject();
    try {
      const result = runCli(dir, ["dist/nope.css"]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(
        "carbon-preprocess-svelte: no CSS files matched",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("exits 2 when --content finds no imports, succeeds with --components", () => {
    const dir = createTempProject();
    try {
      const noImports = runCli(dir, [
        "dist/app.css",
        "--content",
        "nothing/**",
      ]);
      expect(noImports.status).toBe(2);
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

  test("keeps the styles of components a file re-exports or imports as a namespace", () => {
    // A tiny Carbon, since a namespace import has the CLI analyze every
    // component, and the real one has about 170.
    const project = createFakeProject();
    project.installTinyCarbon();
    const { root } = project;
    try {
      mkdirSync(join(root, "src"));
      mkdirSync(join(root, "dist"));
      writeFileSync(
        join(root, "src", "App.svelte"),
        '<script>\n  import { Button } from "carbon-components-svelte";\n</script>\n<Button />\n',
      );
      const css =
        ".bx--btn{color:red}\n.bx--accordion{color:red}\n.bx--tag{color:red}\n";
      const run = (module: string) => {
        writeFileSync(join(root, "src", "carbon.ts"), module);
        writeFileSync(join(root, "dist", "app.css"), css);
        expect(runCli(root, ["dist/app.css", "--silent"]).status).toBe(0);
        return readFileSync(join(root, "dist", "app.css"), "utf-8");
      };

      const reexported = run(
        'export { Accordion } from "carbon-components-svelte";',
      );
      expect(reexported).toContain(".bx--accordion");
      expect(reexported).not.toContain(".bx--tag");
      expect(
        run('import * as Carbon from "carbon-components-svelte";'),
      ).toContain(".bx--tag");
    } finally {
      project.dispose();
    }
  });

  test("--report prints the detected components summary", () => {
    const dir = createTempProject();
    try {
      const result = runCli(dir, ["dist/app.css", "--report"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        "Components that can render (2): Button, Loading",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prunes variants the content never uses, except for --exclude", () => {
    const dir = createTempProject();
    try {
      writeFileSync(
        join(dir, "src", "App.svelte"),
        '<script>\n  import { Button } from "carbon-components-svelte";\n</script>\n<Button kind="tertiary">Save</Button>\n',
      );
      const css =
        ".bx--btn{a:1}\n.bx--btn--tertiary{a:2}\n.bx--btn--danger{a:3}\n";
      writeFileSync(join(dir, "dist", "app.css"), css);

      const result = runCli(dir, ["dist/app.css", "--report"]);
      expect(result.status).toBe(0);
      const pruned = readFileSync(join(dir, "dist", "app.css"), "utf-8");
      expect(pruned).toContain(".bx--btn--tertiary");
      expect(pruned).not.toContain(".bx--btn--danger");
      expect(result.stdout).toMatch(KIND_TERTIARY);

      writeFileSync(join(dir, "dist", "app.css"), css);
      expect(runCli(dir, ["dist/app.css", "--exclude", "Button"]).status).toBe(
        0,
      );
      expect(readFileSync(join(dir, "dist", "app.css"), "utf-8")).toContain(
        ".bx--btn--danger",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--prop-aware, removed in 0.14.0, fails with what to do", () => {
    const dir = createTempProject();
    try {
      const result = runCli(dir, ["dist/app.css", "--prop-aware"]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("--prop-aware was removed in 0.14.0");
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

describe("cli contract", () => {
  const run = (cwd: string, args: string[]) =>
    spawnSync(process.execPath, [CLI_PATH, ...args], { cwd, encoding: "utf8" });

  test("an unknown option exits 2 and suggests the closest one", () => {
    const dir = createTempProject();
    try {
      const result = run(dir, ["optimize-css", "dist/app.css", "--dry-rn"]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(
        "unknown option --dry-rn. Did you mean --dry-run?",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an unknown or missing command exits 2", () => {
    const dir = createTempProject();
    try {
      expect(run(dir, ["optimise-css"]).status).toBe(2);
      expect(run(dir, []).stderr).toContain("no command given");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--version prints the package's version", () => {
    const dir = createTempProject();
    try {
      const pkg = JSON.parse(
        readFileSync(join(import.meta.dirname, "../package.json"), "utf8"),
      );
      const result = run(dir, ["--version"]);
      expect({ status: result.status, out: result.stdout.trim() }).toEqual({
        status: 0,
        out: pkg.version,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--json prints the result as one object, sizes in bytes", () => {
    const dir = createTempProject();
    try {
      const result = run(dir, ["optimize-css", "dist/app.css", "--json"]);
      expect(result.status).toBe(0);
      const out = JSON.parse(result.stdout);
      expect(out).toMatchObject({
        schemaVersion: 1,
        ok: true,
        dryRun: false,
        summary: { files: 1, pruned: 1 },
      });
      expect(out.files).toEqual([
        {
          file: "dist/app.css",
          before: expect.any(Number),
          after: expect.any(Number),
          removed: expect.any(Number),
        },
      ]);
      expect(out.files[0].after).toBeLessThan(out.files[0].before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--json prints an error as an object on stdout, with its kind", () => {
    const dir = createTempProject();
    try {
      const result = run(dir, ["optimize-css", "dist/nope.css", "--json"]);
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout)).toEqual({
        schemaVersion: 1,
        ok: false,
        error: {
          kind: "input",
          message: expect.stringContaining("no CSS files matched"),
        },
      });
      expect(
        run(dir, ["optimize-css", "dist/app.css", "--json", "--report"]).status,
      ).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
