import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { optimizeComponents } from "../src/plugins/optimize-components";
import { createFakeProject } from "./helpers/fake-project";

type Context = {
  warn: jest.Mock;
  info: jest.Mock;
  error: (message: string) => never;
};

type ResolvedPlugin = {
  apply: string;
  enforce: string;
  configResolved(config: { root: string }): void;
  buildStart(this: Context): Promise<void>;
  load(id: string): string | undefined;
  transform(code: string, id: string): void;
  buildEnd(this: Context): void;
};

function context(): Context {
  return {
    warn: jest.fn(),
    info: jest.fn(),
    error: (message: string) => {
      throw new Error(message);
    },
  };
}

const REWROTE = /^rewrote \d+ Carbon components for this app/;
const MISSED_TOOLBAR =
  /before seeing lib\/Toolbar\.ts.*Add those files to `content`/;
const ANALYSIS_FAILED =
  /optimizeComponents could not analyze this build .*Carbon components were bundled unchanged/;
const IMPORT_BUTTON = `import { Button } from "carbon-components-svelte";`;

/** A project with `src/App.svelte` and Carbon linked into its `node_modules`. */
function setUp(
  app: string,
  options?: Parameters<typeof optimizeComponents>[0],
) {
  const project = createFakeProject();
  const carbon = project.linkCarbon();
  mkdirSync(path.join(project.root, "src"));
  writeFileSync(path.join(project.root, "src", "App.svelte"), app);
  const plugin = optimizeComponents(options) as unknown as ResolvedPlugin;
  plugin.configResolved({ root: project.root });
  return { project, carbon, plugin };
}

describe("optimizeComponents", () => {
  test("runs before Svelte, on production builds only", () => {
    const plugin = optimizeComponents() as unknown as ResolvedPlugin;
    expect(plugin.apply).toBe("build");
    expect(plugin.enforce).toBe("pre");
  });

  test("serves Carbon components rewritten for the app's props", async () => {
    const { project, carbon, plugin } = setUp(
      `<script>${IMPORT_BUTTON}</script>\n<Button kind="tertiary">Save</Button>`,
    );
    try {
      const ctx = context();
      await plugin.buildStart.call(ctx);
      expect(ctx.warn).not.toHaveBeenCalled();
      expect(ctx.info.mock.calls[0][0]).toMatch(REWROTE);

      // Through the symlink, as a bundler might see it, and by real path.
      const button = path.join(carbon, "src/Button/Button.svelte");
      const rewritten = plugin.load(button);
      expect(rewritten).toBeDefined();
      expect(plugin.load(realpathSync(button))).toBe(rewritten);
      expect(plugin.load(`${button}?v=1234`)).toBe(rewritten);
      expect(rewritten).toContain(`"bx--btn--tertiary"`);
      expect(rewritten).not.toContain("<ButtonSkeleton");

      // Svelte's style sub-module and unrelated files are left alone.
      expect(
        plugin.load(`${button}?svelte&type=style&lang.css`),
      ).toBeUndefined();
      expect(
        plugin.load(path.join(project.root, "src", "App.svelte")),
      ).toBeUndefined();
    } finally {
      project.dispose();
    }
  });

  test("fails the build when a module outside `content` renders Carbon", async () => {
    const { project, plugin } = setUp(
      `<script>${IMPORT_BUTTON}</script>\n<Button>Save</Button>`,
    );
    try {
      const ctx = context();
      await plugin.buildStart.call(ctx);

      // Analyzed, or not a Carbon importer: fine.
      plugin.transform(
        `<script>${IMPORT_BUTTON}</script>`,
        path.join(project.root, "src", "App.svelte"),
      );
      plugin.transform(
        `import "./app.css";`,
        path.join(project.root, "src", "main.ts"),
      );
      expect(() => plugin.buildEnd.call(ctx)).not.toThrow();

      plugin.transform(
        IMPORT_BUTTON,
        path.join(project.root, "lib", "Toolbar.ts"),
      );
      expect(() => plugin.buildEnd.call(ctx)).toThrow(MISSED_TOOLBAR);
    } finally {
      project.dispose();
    }
  });

  test("`content` decides what's analyzed", async () => {
    const { project, plugin } = setUp(
      `<script>${IMPORT_BUTTON}</script>\n<Button>Save</Button>`,
      { content: ["other/**/*.svelte"], silent: true },
    );
    try {
      const ctx = context();
      await plugin.buildStart.call(ctx);
      // Nothing matched: nothing renders Carbon, so nothing is rewritten.
      expect(ctx.info).not.toHaveBeenCalled();
      expect(
        plugin.load(
          path.join(
            project.root,
            "node_modules/carbon-components-svelte/src/Button/Button.svelte",
          ),
        ),
      ).toBeUndefined();
    } finally {
      project.dispose();
    }
  });

  test("leaves Carbon unchanged with a warning when analysis fails", async () => {
    const project = createFakeProject();
    project.installBrokenCarbon();
    mkdirSync(path.join(project.root, "src"));
    writeFileSync(
      path.join(project.root, "src", "App.svelte"),
      `<script>${IMPORT_BUTTON}</script>\n<Button />`,
    );
    const plugin = optimizeComponents() as unknown as ResolvedPlugin;
    plugin.configResolved({ root: project.root });
    try {
      const ctx = context();
      await plugin.buildStart.call(ctx);
      expect(ctx.warn).toHaveBeenCalledTimes(1);
      expect(ctx.warn.mock.calls[0][0]).toMatch(ANALYSIS_FAILED);
      plugin.transform(IMPORT_BUTTON, path.join(project.root, "lib", "x.ts"));
      // With nothing rewritten, an unanalyzed importer is harmless.
      expect(() => plugin.buildEnd.call(ctx)).not.toThrow();
    } finally {
      project.dispose();
    }
  });
});
