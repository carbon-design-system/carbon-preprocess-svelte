import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { optimizeComponents } from "../src/plugins/optimize-components";
import { createFakeProject } from "./helpers/fake-project";

type Context = {
  resolve: (source: string, importer: string) => Promise<{ id: string } | null>;
  warn: jest.Mock;
  info: jest.Mock;
  error: (message: string) => never;
};

type ResolvedPlugin = {
  apply: string;
  enforce: string;
  configResolved(config: { root: string }): void;
  buildStart(this: Context): Promise<void>;
  load(id: string): { code: string; map: { mappings: string } } | undefined;
  transform(code: string, id: string): void;
  buildEnd(this: Context & GraphContext): Promise<void>;
};

type GraphContext = {
  getModuleIds(): IterableIterator<string>;
  getModuleInfo(id: string): {
    code?: string;
    importers: string[];
    dynamicImporters: string[];
    isEntry: boolean;
  } | null;
};

function context(aliases: Record<string, string> = {}): Context & GraphContext {
  return {
    resolve: async (source) =>
      aliases[source] ? { id: aliases[source] } : null,
    getModuleIds: () => [][Symbol.iterator](),
    getModuleInfo: () => null,
    warn: jest.fn(),
    info: jest.fn(),
    error: (message: string) => {
      throw new Error(message);
    },
  };
}

const REWROTE = /^rewrote \d+ Carbon components for this app/;
const MISSED_TOOLBAR =
  /before seeing lib\/Toolbar\.ts, which imports them\. Add those files to `content`/;
const MISSED_MARKDOWN = /before seeing lib\/Toolbar\.md, which imports them/;
const ANALYSIS_FAILED =
  /optimizeComponents could not analyze this build .*Carbon components were bundled unchanged/;
const VIRTUAL_MODULE =
  /can't analyze virtual:toolbar, which imports Carbon components but has no file on disk/;
const VIRTUAL_MODULES =
  /can't analyze virtual:toolbar, virtual:menu, which import Carbon components but have no file on disk/;
const BUTTON_REPORT =
  /Button +\d+ edits +no longer renders .*ButtonSkeleton[\s\S]*No longer bundled \(\d+\): .*ButtonSkeleton/;
const WRAPPER_ESCAPED =
  /read the props of src[\\/]Card\.svelte from its call sites in `content`, but lib[\\/]Page\.svelte also renders it\./;
const IMPORT_BUTTON = `import { Button } from "carbon-components-svelte";`;
const UNREAD_MODAL =
  /can't read how src[\\/]App\.svelte imports Carbon's Modal/;
const UNREAD_BARREL =
  /can't read how src[\\/]Other\.svelte imports `carbon-components-svelte`/;
const UNREAD_ALIAS = /can't read how src[\\/]App\.svelte imports `@carbon`/;

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
      expect(rewritten?.code).toContain(`"bx--btn--tertiary"`);
      expect(rewritten?.code).not.toContain("<ButtonSkeleton");
      expect(rewritten?.map.mappings).not.toBe("");

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

  test.each([
    ["4.2.19", true],
    ["5.0.0", false],
  ])("with Svelte %s, keeps `{#if true}` blocks: %p", async (version, kept) => {
    const { project, carbon, plugin } = setUp(
      `<script>${IMPORT_BUTTON}</script>\n<Button kind="tertiary">Save</Button>`,
    );
    try {
      const svelte = path.join(project.root, "node_modules", "svelte");
      mkdirSync(svelte);
      writeFileSync(
        path.join(svelte, "package.json"),
        JSON.stringify({ name: "svelte", version }),
      );
      await plugin.buildStart.call(context());
      const button = plugin.load(path.join(carbon, "src/Button/Button.svelte"));
      expect(button?.code.includes("{#if true}")).toBe(kept);
    } finally {
      project.dispose();
    }
  });

  test("a rebuild reanalyzes only when `content` changed", async () => {
    const { project, carbon, plugin } = setUp(
      `<script>${IMPORT_BUTTON}</script>\n<Button kind="tertiary">Save</Button>`,
    );
    try {
      const button = path.join(carbon, "src/Button/Button.svelte");
      await plugin.buildStart.call(context());
      const first = plugin.load(button);
      await plugin.buildStart.call(context());
      expect(plugin.load(button)).toBe(first);

      writeFileSync(
        path.join(project.root, "src", "App.svelte"),
        `<script>${IMPORT_BUTTON}</script>\n<Button kind="danger">Delete</Button>`,
      );
      await plugin.buildStart.call(context());
      expect(plugin.load(button)?.code).toContain(`"bx--btn--danger"`);
    } finally {
      project.dispose();
    }
  });

  test("`report` prints what each component lost", async () => {
    const { project, plugin } = setUp(
      `<script>${IMPORT_BUTTON}</script>\n<Button kind="tertiary">Save</Button>`,
      { report: true, silent: true },
    );
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await plugin.buildStart.call(context());
      const report = log.mock.calls.map(([line]) => line).join("\n");
      expect(report).toContain("optimizeComponents report");
      expect(report).toMatch(BUTTON_REPORT);
      expect(report).toContain('kind             "tertiary"');
    } finally {
      log.mockRestore();
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
      await expect(plugin.buildEnd.call(ctx)).resolves.toBeUndefined();

      plugin.transform(
        IMPORT_BUTTON,
        path.join(project.root, "lib", "Toolbar.ts"),
      );
      await expect(plugin.buildEnd.call(ctx)).rejects.toThrow(MISSED_TOOLBAR);
    } finally {
      project.dispose();
    }
  });

  test("by default, scripts and Markdown in `src` are analyzed too", async () => {
    const { project, carbon, plugin } = setUp(
      `<script>${IMPORT_BUTTON}</script>\n<Button kind="tertiary">Save</Button>`,
    );
    try {
      const store = path.join(project.root, "src", "dialogs.ts");
      writeFileSync(store, `import { Modal } from "carbon-components-svelte";`);
      const page = path.join(project.root, "src", "about.md");
      writeFileSync(page, `<script>${IMPORT_BUTTON}</script>\n\n<Button />`);
      const ctx = context();
      await plugin.buildStart.call(ctx);
      plugin.transform(
        `import { Modal } from "carbon-components-svelte";`,
        store,
      );
      plugin.transform(
        `import { Button } from "carbon-components-svelte";`,
        page,
      );
      await expect(plugin.buildEnd.call(ctx)).resolves.toBeUndefined();

      // Imported from a script or Markdown: every prop value stays.
      expect(
        plugin.load(path.join(carbon, "src/Modal/Modal.svelte")),
      ).toBeDefined();
      const button = plugin.load(path.join(carbon, "src/Button/Button.svelte"));
      expect(button?.code).not.toContain(`"bx--btn--tertiary"`);
    } finally {
      project.dispose();
    }
  });

  test("checks a wrapper's importers against the module graph", async () => {
    const { project, plugin } = setUp(
      `<script>import Card from "./Card.svelte";</script>\n<Card tone="danger" />`,
      { silent: true },
    );
    try {
      const src = path.join(project.root, "src");
      const card = path.join(src, "Card.svelte");
      writeFileSync(
        card,
        `<script>${IMPORT_BUTTON}\nexport let tone = "primary";</script>\n<Button kind={tone} />`,
      );
      writeFileSync(
        path.join(src, "main.ts"),
        `import App from "./App.svelte";`,
      );
      await plugin.buildStart.call(context());
      // Every call site is known, so the wrapper is rewritten too.
      expect(plugin.load(card)?.code).toContain(`kind={"danger"}`);
      const graph = (importers: string[], dynamic: string[] = []) => ({
        ...context(),
        getModuleIds: () => [card][Symbol.iterator](),
        getModuleInfo: () => ({
          importers,
          dynamicImporters: dynamic,
          isEntry: false,
        }),
      });

      const app = path.join(src, "App.svelte");
      await expect(plugin.buildEnd.call(graph([app]))).resolves.toBeUndefined();
      const other = path.join(project.root, "lib", "Page.svelte");
      await expect(plugin.buildEnd.call(graph([app, other]))).rejects.toThrow(
        WRAPPER_ESCAPED,
      );
    } finally {
      project.dispose();
    }
  });

  test("fails the build on an import of Carbon the analysis can't read", async () => {
    const { project, carbon, plugin } = setUp(
      `<script>${IMPORT_BUTTON}\nimport { Modal } from "@carbon";</script>\n<Button /><Modal open />`,
      { silent: true },
    );
    try {
      const src = path.join(project.root, "src");
      const app = path.join(src, "App.svelte");
      const other = path.join(src, "Other.svelte");
      writeFileSync(other, `<script>import { Tag } from "@carbon";</script>`);
      await plugin.buildStart.call(context());
      // The module graph, as the bundler resolved the alias.
      const graph = (edges: Record<string, string[]>) => ({
        ...context(),
        getModuleIds: () =>
          Object.keys(edges)
            .map((key) => path.join(carbon, "src", key))
            [Symbol.iterator](),
        getModuleInfo: (id: string) => ({
          importers: edges[path.relative(path.join(carbon, "src"), id)] ?? [],
          dynamicImporters: [],
          isEntry: false,
        }),
      });

      // What the analysis read: Button, from the barrel.
      await expect(
        plugin.buildEnd.call(
          graph({ "index.js": [app], "Button/Button.svelte": [app] }),
        ),
      ).resolves.toBeUndefined();
      await expect(
        plugin.buildEnd.call(graph({ "Modal/Modal.svelte": [app] })),
      ).rejects.toThrow(UNREAD_MODAL);
      await plugin.buildStart.call(context());
      await expect(
        plugin.buildEnd.call(graph({ "index.js": [other] })),
      ).rejects.toThrow(UNREAD_BARREL);

      // The barrel through an alias, beside an import of it the analysis
      // read: only the importer's code tells them apart.
      await plugin.buildStart.call(context());
      const barrel = path.join(carbon, "src/index.js");
      await expect(
        plugin.buildEnd.call({
          ...graph({ "index.js": [app] }),
          resolve: async (source: string) =>
            source === "@carbon" ? { id: barrel } : null,
          getModuleInfo: (id: string) =>
            id === app
              ? {
                  code: `import { Button } from "carbon-components-svelte";\nimport { Modal } from "@carbon";`,
                  importers: [],
                  dynamicImporters: [],
                  isEntry: false,
                }
              : { importers: [app], dynamicImporters: [], isEntry: false },
        }),
      ).rejects.toThrow(UNREAD_ALIAS);
    } finally {
      project.dispose();
    }
  });

  test("follows a wrapper imported through an alias the bundler resolves", async () => {
    const { project, carbon, plugin } = setUp(
      `<script>import Card from "$lib/Card.svelte";</script>\n<Card tone="danger" />`,
      { silent: true },
    );
    try {
      const lib = path.join(project.root, "src", "lib");
      mkdirSync(lib);
      const card = path.join(lib, "Card.svelte");
      writeFileSync(
        card,
        `<script>${IMPORT_BUTTON}\nexport let tone = "primary";</script>\n<Button kind={tone} />`,
      );
      writeFileSync(
        path.join(project.root, "src", "main.ts"),
        `import App from "./App.svelte";`,
      );
      const button = path.join(carbon, "src/Button/Button.svelte");

      await plugin.buildStart.call(context({ "$lib/Card.svelte": card }));
      expect(plugin.load(button)?.code).toContain(`"bx--btn--danger"`);

      // Unresolved, the alias can't be told apart: every kind stays.
      await plugin.buildStart.call(context());
      expect(plugin.load(button)?.code).not.toContain(`"bx--btn--danger"`);
    } finally {
      project.dispose();
    }
  });

  test("fails the build when a virtual module renders Carbon", async () => {
    const { plugin } = setUp(
      `<script>${IMPORT_BUTTON}</script>\n<Button>Save</Button>`,
    );
    const ctx = context();
    await plugin.buildStart.call(ctx);
    plugin.transform(IMPORT_BUTTON, "\0virtual:toolbar");
    await expect(plugin.buildEnd.call(ctx)).rejects.toThrow(VIRTUAL_MODULE);
  });

  test("names every virtual module that renders Carbon", async () => {
    const { plugin } = setUp(
      `<script>${IMPORT_BUTTON}</script>\n<Button>Save</Button>`,
    );
    const ctx = context();
    await plugin.buildStart.call(ctx);
    plugin.transform(IMPORT_BUTTON, "\0virtual:toolbar");
    plugin.transform(IMPORT_BUTTON, "\0virtual:menu");
    await expect(plugin.buildEnd.call(ctx)).rejects.toThrow(VIRTUAL_MODULES);
  });

  test.each([
    ["a re-export", `export { Button } from "carbon-components-svelte";`],
    ["a namespace import", `import * as C from "carbon-components-svelte";`],
    [
      "a dynamic import",
      `export const load = () => import("carbon-components-svelte/src/Button/Button.svelte");`,
    ],
    [
      "a dynamic import of the barrel",
      `export const load = () => import("carbon-components-svelte");`,
    ],
  ])("fails the build on %s of Carbon outside `content`", async (_, code) => {
    const { project, plugin } = setUp(
      `<script>${IMPORT_BUTTON}</script>\n<Button>Save</Button>`,
    );
    try {
      const ctx = context();
      await plugin.buildStart.call(ctx);
      plugin.transform(code, path.join(project.root, "lib", "Toolbar.ts"));
      await expect(plugin.buildEnd.call(ctx)).rejects.toThrow(MISSED_TOOLBAR);

      // The same in a virtual module.
      const virtual = context();
      await plugin.buildStart.call(virtual);
      plugin.transform(code, "\0virtual:toolbar");
      await expect(plugin.buildEnd.call(virtual)).rejects.toThrow(
        VIRTUAL_MODULE,
      );
    } finally {
      project.dispose();
    }
  });

  test("a type-only re-export of Carbon passes", async () => {
    const { project, plugin } = setUp(
      `<script>${IMPORT_BUTTON}</script>\n<Button>Save</Button>`,
    );
    try {
      const ctx = context();
      await plugin.buildStart.call(ctx);
      plugin.transform(
        `export type { ButtonProps } from "carbon-components-svelte";`,
        path.join(project.root, "lib", "types.ts"),
      );
      await expect(plugin.buildEnd.call(ctx)).resolves.toBeUndefined();
    } finally {
      project.dispose();
    }
  });

  test("a `package.json` or Markdown that only mentions carbon-components-svelte passes", async () => {
    const { project, plugin } = setUp(
      `<script>${IMPORT_BUTTON}</script>\n<Button>Save</Button>`,
    );
    try {
      const ctx = context();
      await plugin.buildStart.call(ctx);
      plugin.transform(
        `{ "dependencies": { "carbon-components-svelte": "^0.113.1" } }`,
        path.join(project.root, "package.json"),
      );
      plugin.transform(
        "Built with `carbon-components-svelte`.",
        path.join(project.root, "README.md"),
      );
      await expect(plugin.buildEnd.call(ctx)).resolves.toBeUndefined();

      plugin.transform(
        `${IMPORT_BUTTON}\n\n<Button>Save</Button>`,
        path.join(project.root, "lib", "Toolbar.md"),
      );
      await expect(plugin.buildEnd.call(ctx)).rejects.toThrow(MISSED_MARKDOWN);
    } finally {
      project.dispose();
    }
  });

  test("a virtual module that only mentions carbon-components-svelte passes", async () => {
    const { plugin } = setUp(
      `<script>${IMPORT_BUTTON}</script>\n<Button>Save</Button>`,
    );
    const ctx = context();
    await plugin.buildStart.call(ctx);
    plugin.transform(
      'export default { Button: { path: "carbon-components-svelte/src/Button/Button.svelte" } };',
      "\0virtual:api",
    );
    plugin.transform(
      'export default { page: () => import("/docs/carbon-components-svelte/Button.svx") };',
      "\0virtual:pages",
    );
    await expect(plugin.buildEnd.call(ctx)).resolves.toBeUndefined();
  });

  test("a `content` pattern that names `node_modules` reaches inside it", async () => {
    const { project, plugin } = setUp(
      `<script>${IMPORT_BUTTON}</script>\n<Button>Save</Button>`,
      {
        content: ["src/**/*.svelte", "node_modules/ui-kit/**/*.svelte"],
        silent: true,
      },
    );
    try {
      const kit = path.join(project.root, "node_modules", "ui-kit");
      mkdirSync(kit);
      const toolbar = path.join(kit, "Toolbar.svelte");
      writeFileSync(toolbar, `<script>${IMPORT_BUTTON}</script>\n<Button />`);
      const ctx = context();
      await plugin.buildStart.call(ctx);
      plugin.transform(IMPORT_BUTTON, toolbar);
      await expect(plugin.buildEnd.call(ctx)).resolves.toBeUndefined();
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
      await expect(plugin.buildEnd.call(ctx)).resolves.toBeUndefined();
    } finally {
      project.dispose();
    }
  });
});
