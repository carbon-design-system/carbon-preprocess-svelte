import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { optimizeCarbonCss } from "carbon-preprocess-svelte";
import { createFakeProject } from "./helpers/fake-project";

describe("optimizeCarbonCss: component index unavailable", () => {
  test("warns and returns the CSS unpruned", async () => {
    const project = createFakeProject();
    project.installBrokenCarbon();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const css = ".bx--btn{color:red}.bx--accordion{color:blue}";

    try {
      const result = await optimizeCarbonCss(css, {
        components: ["Button"],
        cwd: project.root,
      });

      expect(result).toEqual({ css, removed: 0 });
      expect(warn.mock.calls[0][0]).toContain("leaving Carbon CSS unpruned");
    } finally {
      warn.mockRestore();
      project.dispose();
    }
  });
});

describe("optimizeCarbonCss", () => {
  test("keeps classes of named components", async () => {
    const result = await optimizeCarbonCss(
      ".bx--btn{color:red}.bx--accordion{color:blue}",
      { components: ["Button"] },
    );
    expect(result.css).toEqual(".bx--btn{color:red}");
    expect(result.removed).toBeGreaterThan(0);
  });

  test("accepts component paths", async () => {
    const result = await optimizeCarbonCss(
      ".bx--btn{color:red}.bx--accordion{color:blue}",
      {
        components: [
          "/n/node_modules/carbon-components-svelte/src/Button/Button.svelte",
        ],
      },
    );
    expect(result.css).toEqual(".bx--btn{color:red}");
    expect(result.removed).toBeGreaterThan(0);
  });

  test("returns the input unchanged for an empty component list", async () => {
    const css = ".bx--btn{color:red}";

    const fromString = await optimizeCarbonCss(css, { components: [] });
    expect(fromString).toEqual({ css, removed: 0 });

    const fromBytes = await optimizeCarbonCss(new TextEncoder().encode(css), {
      components: [],
    });
    expect(fromBytes).toEqual({ css, removed: 0 });
  });

  test("`sources` keeps literal tokens", async () => {
    const result = await optimizeCarbonCss(
      ".bx--btn{color:red}.bx--accordion{color:blue}",
      {
        components: ["Button"],
        sources: ['const c = "bx--accordion";'],
      },
    );
    expect(result.css).toEqual(".bx--btn{color:red}.bx--accordion{color:blue}");
    expect(result.removed).toBe(0);
  });

  test("`content` resolves from `cwd`", async () => {
    const dir = mkdtempSync(join(tmpdir(), "optimize-carbon-css-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(
        join(dir, "src", "App.svelte"),
        '<div class="bx--accordion"></div>',
      );

      const result = await optimizeCarbonCss(
        ".bx--btn{color:red}.bx--accordion{color:blue}",
        {
          components: ["Button"],
          content: ["src/*.svelte"],
          cwd: dir,
        },
      );
      expect(result.css).toEqual(
        ".bx--btn{color:red}.bx--accordion{color:blue}",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("`safelist` and `preserveAllIBMFonts` pass through", async () => {
    const grid = ".bx--grid{display:grid}";
    const safelisted = await optimizeCarbonCss(grid, {
      components: ["Button"],
      safelist: [".bx--grid"],
    });
    expect(safelisted.css).toEqual(grid);

    const fontRules = `@font-face {
  font-family: IBM Plex Sans;
  font-style: italic;
  font-weight: 400;
}`;
    const withFonts = await optimizeCarbonCss(fontRules, {
      components: ["Button"],
      preserveAllIBMFonts: true,
    });
    expect(withFonts.css).toEqual(fontRules);
  });
});
