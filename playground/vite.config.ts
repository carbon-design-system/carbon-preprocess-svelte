// The playground: carbon-preprocess-svelte's own docs-site testbed. Pages go
// through markdown() (the kitchen sink twice: `.svx` with one Prose per
// Markdown run, `.md`, a symlink, with one Prose for the page), imports
// through optimizeImports(), and the build through optimizeComponents() and
// optimizeCss(). Code views use the browser-safe `carbon-preprocess-svelte/code`.
//
// carbon-components-svelte is the installed package. `CCS_DIR=<checkout>`
// uses a local CCS checkout instead, for unreleased work such as Prose, and
// adds its docs pages (`CCS_PAGES`), framed examples, and component API.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
// The built-in highlighter: Carbon syntax tokens, no Prism.
import {
  carbonCodeIcon,
  compileMarkdown,
  encodeTokens,
  highlight,
  type MarkdownOptions,
  markdown,
  markdownToHtml,
  optimizeComponents,
  optimizeCss,
  optimizeImports,
  parseCodeMeta,
  prepareFence,
  terminalLines,
} from "carbon-preprocess-svelte";
import { sveld } from "sveld";
import { createLogger, loadEnv } from "vite";
import { GALLERY, GALLERY_BASE } from "./gallery";
import { analyze } from "./src/intel/analyze.js";
import { toJSDoc, toTypeScript } from "./src/intel/typescript.js";

const HERE = import.meta.dirname;
// `CCS_DIR` from the environment, else from `playground/.env.local`
// (git-ignored, relative to the playground), so a checkout sticks. An empty
// `CCS_DIR` in the environment means the installed package, whatever the
// file says: the tests and e2e builds set it.
const LOCAL_ENV = loadEnv("", HERE, "");
const CCS_DIR_SETTING =
  process.env.CCS_DIR !== undefined
    ? process.env.CCS_DIR && path.resolve(process.env.CCS_DIR)
    : LOCAL_ENV.CCS_DIR && path.resolve(HERE, LOCAL_ENV.CCS_DIR);
const CCS_DIR = CCS_DIR_SETTING || undefined;
const CCS = CCS_DIR ?? path.join(HERE, "node_modules/carbon-components-svelte");
// A checkout's docs: pages, framed example sources, and COMPONENT_API.json.
const DOCS =
  CCS_DIR && existsSync(path.join(CCS_DIR, "docs/src"))
    ? path.join(CCS_DIR, "docs")
    : undefined;
const HAS_PROSE = existsSync(path.join(CCS, "src/Prose/Prose.svelte"));
// The checkout's docs pages to list (each must build on its own).
const CCS_PAGES = (
  process.env.CCS_PAGES ??
  LOCAL_ENV.CCS_PAGES ??
  "ComboBox,Form,FloatingPortal,Prose,SessionStorage"
).split(",");
/**
 * The build optimizers (optimizeComponents, optimizeCss) read the installed
 * CCS: they don't follow `resolve.alias`, so with CCS_DIR they'd skip the
 * checkout's components and prune the CSS of the ones the installed CCS
 * doesn't have (Prose's). They run against the installed CCS, as CI builds.
 */
const OPTIMIZE = !CCS_DIR;
/** The checkout's docs pages in `CCS_PAGES` that exist. */
const CCS_PAGE_FILES = DOCS
  ? CCS_PAGES.map((name) =>
      path.join(DOCS, "src/pages/components", `${name}.svx`),
    ).filter((file) => existsSync(file))
  : [];
const CCS_VERSION: string = JSON.parse(
  readFileSync(path.join(CCS, "package.json"), "utf8"),
).version;
const SCRIPT_BLOCK = /^<script\b/;
const FILE_SOURCE_SRC = /src="([^"]+)"/;
const DOCS_ONLY =
  /^[ \t]*(?:\/\/|<!--)[ \t]*docs-only:start\b[\s\S]*?^[ \t]*(?:\/\/|<!--)[ \t]*docs-only:end\b.*(?:\r?\n|$)/gm;

// Framed examples that exist only in the preview (multi-file demos).
const LOCAL_PAGES = path.join(HERE, "src");
const RELATIVE_IMPORT = /\bfrom\s+["'](\.\.?\/[^"']+)["']/g;
const LANGS: Record<string, string> = {
  ".svelte": "svelte",
  ".js": "js",
  ".ts": "ts",
  ".json": "json",
  ".css": "css",
};

function framedFile(src: string): string | undefined {
  return [
    DOCS && path.join(DOCS, "src/pages", `${src}.svelte`),
    path.join(LOCAL_PAGES, `${src}.svelte`),
  ]
    .filter((file): file is string => Boolean(file))
    .find(existsSync);
}

function framedSource(src: string): string | undefined {
  const file = framedFile(src);
  return file
    ? readFileSync(file, "utf8").replace(DOCS_ONLY, "").replace(/\n$/, "")
    : undefined;
}

/**
 * A framed example's files: the example, then the local modules it imports
 * (`./rows.js`, `./Cell.svelte`), so a multi-file example shows as tabs
 * with no extra markup.
 */
function framedFiles(src: string) {
  const file = framedFile(src);
  if (!file) return [];
  const files: {
    name: string;
    lang: string;
    code: string;
    views?: Record<string, View>;
  }[] = [
    {
      name: path.basename(file),
      lang: "svelte",
      code: framedSource(src) ?? "",
    },
  ];
  for (const [, specifier] of files[0].code.matchAll(RELATIVE_IMPORT)) {
    const imported = path.resolve(path.dirname(file), specifier);
    if (!existsSync(imported)) continue;
    const code = readFileSync(imported, "utf8")
      .replace(DOCS_ONLY, "")
      .replace(/\n$/, "");
    files.push({
      name: path.basename(imported),
      lang: LANGS[path.extname(imported)] ?? "text",
      code,
    });
  }
  for (const f of files)
    f.views = prepareViews(f.code, f.lang, "", true, originOf(file));
  return files;
}

/**
 * COMPONENT_API.json (sveld's output) for the CCS in use: the checkout's
 * docs copy, else generated from the installed package's source, cached by
 * version (under a second).
 */
/** The parts of sveld's COMPONENT_API.json the index reads. */
type SveldComponent = {
  moduleName: string;
  filePath: string;
  generics?: [string, string];
  rest_props?: { name?: string };
  props: {
    name: string;
    kind: string;
    type?: string;
    value?: string;
    defaultValue?: { raw?: string };
    description?: string;
    binding?: boolean | string;
    isRequired?: boolean;
  }[];
  events: { type: string; name: string; detail?: string; element?: string }[];
  slots?: { default?: boolean; name?: string; slot_props?: string }[];
  typedefs?: { name: string; ts: string }[];
};

async function componentApi(): Promise<{ components: SveldComponent[] }> {
  const docsCopy = DOCS && path.join(DOCS, "src/COMPONENT_API.json");
  if (docsCopy && existsSync(docsCopy))
    return JSON.parse(readFileSync(docsCopy, "utf8"));
  const { version } = JSON.parse(
    readFileSync(path.join(CCS, "package.json"), "utf8"),
  );
  const cache = path.join(
    HERE,
    `node_modules/.cache/playground/component-api-${version}.json`,
  );
  if (!existsSync(cache)) {
    mkdirSync(path.dirname(cache), { recursive: true });
    // sveld reads `src/` from the working directory.
    const cwd = process.cwd();
    process.chdir(CCS);
    try {
      await sveld({
        glob: true,
        json: true,
        jsonOptions: { outFile: cache },
        types: false,
      } as Parameters<typeof sveld>[0]);
    } finally {
      process.chdir(cwd);
    }
  }
  return JSON.parse(readFileSync(cache, "utf8"));
}

/** Each component's docs page and description, from a checkout's docs frontmatter. */
function docsPages(): Record<string, { page: string; description: string }> {
  const docs: Record<string, { page: string; description: string }> = {};
  const pages = DOCS && path.join(DOCS, "src/pages/components");
  if (!pages || !existsSync(pages)) return docs;
  for (const file of readdirSync(pages).filter((f) => f.endsWith(".svx"))) {
    const source = readFileSync(path.join(pages, file), "utf8");
    const page = file.replace(".svx", "");
    const description =
      /^description:\s*(.*)$/m.exec(source)?.[1]?.trim() ?? "";
    const list = /^components:\s*\[(.*)\]/m.exec(source)?.[1];
    const names = list
      ? [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1])
      : [page];
    for (const name of new Set([page, ...names]))
      docs[name] ??= { page, description };
  }
  return docs;
}

/** The compact component index for hover cards and typed views, built once. */
async function buildApiIndex(): Promise<Record<string, unknown>> {
  const api = await componentApi();
  const docs = docsPages();
  const components: Record<string, unknown> = {};
  for (const c of api.components) {
    components[c.moduleName] = {
      path: c.filePath,
      page: docs[c.moduleName]?.page,
      description: docs[c.moduleName]?.description ?? "",
      generics: c.generics,
      rest: c.rest_props?.name,
      props: c.props
        .filter((p) => p.kind !== "function" && p.kind !== "const")
        .map((p) => ({
          name: p.name,
          type: p.type,
          default: p.defaultValue?.raw ?? p.value,
          description: p.description,
          bindable: p.binding,
          required: p.isRequired,
        })),
      events: c.events.map((e) => ({
        name: e.name,
        kind: e.type,
        detail: e.detail,
        element: e.element,
      })),
      slots: (c.slots ?? []).map((s) => ({
        name: s.default ? "default" : s.name,
        props: s.slot_props,
      })),
      typedefs: (c.typedefs ?? []).map((t) => ({
        name: t.name,
        ts: t.ts,
      })),
    };
  }
  return components;
}

const API_INDEX = await buildApiIndex();
const apiIndex = () => API_INDEX;

/**
 * `src/pages/Stress.svx`: a performance fixture, written at startup (it's
 * git-ignored): one 1,600-line block of this repo's own source, and 60
 * small Svelte blocks.
 */
function stressPage() {
  return {
    name: "playground-stress-page",
    buildStart() {
      const file = path.join(HERE, "src/pages/Stress.svx");
      const source = ["blocks.ts", "inline.ts", "compile.ts"]
        .map((name) =>
          readFileSync(path.join(HERE, "../src/markdown", name), "utf8"),
        )
        .join("\n")
        .split("\n")
        .slice(0, 1600)
        .join("\n");
      const small =
        '```svelte {2}\n<script>\n  import { ComboBox } from "carbon-components-svelte";\n  let selectedId;\n</script>\n\n<ComboBox labelText="Region" items={[]} bind:selectedId />\n```\n';
      const fence = "````";
      const page = `---\ntitle: Stress\ndescription: "One 1,600-line block and 60 small ones: a load and scroll fixture."\n---\n\n${fence}ts showLineNumbers\n${source}\n${fence}\n\n${Array.from({ length: 60 }, () => small).join("\n")}`;
      // Rewritten only when it changes, so Vite doesn't reload for nothing.
      if (!existsSync(file) || readFileSync(file, "utf8") !== page)
        writeFileSync(file, page);
    },
  };
}

/**
 * Restarts the dev server when the library rebuilds (`bun run build` in the
 * repo root): Vite loads preprocessors once, at startup, so a running server
 * would keep compiling pages with the old `markdown()`.
 */
function restartOnLibraryBuild() {
  // The build copies package.json into a fresh dist first and rewrites it
  // last, with its `./dist/` paths made `./`: that one is a finished build.
  const manifest = path.join(HERE, "../dist/package.json");
  const finished = () => {
    if (!existsSync(manifest)) return undefined;
    const text = readFileSync(manifest, "utf8");
    return text.includes('"./dist/') ? undefined : statSync(manifest).mtimeMs;
  };
  // The build restarted for, kept across restarts (each reloads this
  // config): one write can fire more than one event.
  const seen = globalThis as { __playgroundLibraryBuild?: number };
  seen.__playgroundLibraryBuild ??= finished();
  return {
    name: "playground-restart-on-library-build",
    apply: "serve" as const,
    configureServer(server: {
      watcher: {
        add: (path: string) => void;
        on: (event: string, listener: (file: string) => void) => void;
      };
      restart: () => Promise<void>;
      config: { logger: { info: (message: string) => void } };
    }) {
      server.watcher.add(manifest);
      const onChange = (file: string) => {
        if (file !== manifest) return;
        const build = finished();
        if (build === undefined || build === seen.__playgroundLibraryBuild)
          return;
        seen.__playgroundLibraryBuild = build;
        server.config.logger.info(
          "carbon-preprocess-svelte rebuilt: restarting",
        );
        server.restart();
      };
      server.watcher.on("add", onChange);
      server.watcher.on("change", onChange);
    },
  };
}

/**
 * Fails a build whose output names a local directory (the home directory,
 * this repo, or the CCS checkout), so a define or a diagnostic can't ship
 * where the playground was built.
 */
function noLocalPaths() {
  const paths = [...new Set([homedir(), path.dirname(HERE), CCS])].filter(
    (p) => p.length > 1,
  );
  return {
    name: "playground-no-local-paths",
    apply: "build" as const,
    generateBundle(
      _: unknown,
      bundle: Record<string, { code?: string; source?: string | Uint8Array }>,
    ) {
      for (const [name, file] of Object.entries(bundle)) {
        const text =
          file.code ?? (typeof file.source === "string" ? file.source : "");
        const found = paths.find((p) => text.includes(p));
        if (found) throw new Error(`${name} contains a local path: ${found}`);
      }
    },
  };
}

/**
 * The options gallery (`gallery.ts`): each variant's sample compiled with
 * `compileMarkdown` to `src/gallery/<option>-<n>.svelte`, and the page that
 * lays them out, `src/pages/Options.svx`, written at startup (git-ignored).
 * Without Prose in the CCS in use, every variant is compiled without it.
 */
function optionsGallery() {
  const write = (file: string, text: string) => {
    if (!existsSync(file) || readFileSync(file, "utf8") !== text)
      writeFileSync(file, text);
  };
  return {
    name: "playground-options-gallery",
    async buildStart() {
      const dir = path.join(HERE, "src/gallery");
      mkdirSync(dir, { recursive: true });
      // Every variant compiled at once; then the page, option by option.
      const compiled = await Promise.all(
        GALLERY.flatMap((option) =>
          option.variants.map(async (variant, n) => {
            const name = `${option.name}-${n}`;
            const { code } = await compileMarkdown(option.sample, {
              ...GALLERY_BASE,
              ...variant.options,
              prose: HAS_PROSE ? (variant.options.prose ?? true) : false,
              filename: `${name}.md`,
            });
            write(path.join(dir, `${name}.svelte`), code);
            return { option, variant, name, local: `G_${option.name}_${n}` };
          }),
        ),
      );
      const imports = compiled.map(
        ({ name, local }) =>
          `  import ${local} from "../gallery/${name}.svelte";`,
      );
      const sections = GALLERY.map((option) => {
        const items = compiled
          .filter((c) => c.option === option)
          .map(
            ({ variant, local }) =>
              `{ label: ${JSON.stringify(variant.label)}, component: ${local} }`,
          );
        const configs = option.variants
          .map((v) => `// ${v.label}\n${v.config};`)
          .join("\n\n");
        return [
          `## ${option.name}`,
          option.description,
          option.name === "prose" && !HAS_PROSE
            ? "> [!NOTE]\n> The CCS in use has no Prose, so both are plain HTML here."
            : "",
          `\`\`\`\`md title="Sample"\n${option.sample}\n\`\`\`\``,
          `\`\`\`js title="svelte.config.js"\n${configs}\n\`\`\``,
          `<GalleryRow items={[${items.join(", ")}]} />`,
        ]
          .filter(Boolean)
          .join("\n\n");
      });
      write(
        path.join(HERE, "src/pages/Options.svx"),
        `---\ntitle: Options gallery\ndescription: "One sample under each markdown() option: the default first, then the option's other values, each compiled by compileMarkdown."\nexamples: false\n---\n\n<script>\n  import GalleryRow from "../GalleryRow.svelte";\n${imports.join("\n")}\n</script>\n\n${sections.join("\n\n")}\n`,
      );
    },
  };
}

/**
 * The build report (`virtual:build-report`, the Build report page):
 * - `examples`: every example's CSS before and after, from the e2e snapshot;
 * - `lastBuild`: this playground's last `vite build`, from what
 *   `optimizeCss` and `optimizeComponents` logged (through `logger` below)
 *   and the emitted assets, saved in `node_modules/.cache/playground/`;
 * - `imports`: what `optimizeImports` rewrites in each file, run here on
 *   each file's script.
 */
const BUILD_REPORT = path.join(
  HERE,
  "node_modules/.cache/playground/build-report.json",
);
const OPTIMIZED_CSS =
  /Optimized (\S+)\s+Before:\s+([\d.]+ \w+)\s+After:\s+([\d.]+ \w+) \(-([\d.]+)%\)/;
const REWROTE = /rewrote (\d+) Carbon components for this app \((\d+) edits\)/;
const IMPORT_LINE =
  /^\s*import\b.*["']carbon-(?:components|icons)-svelte[^"']*["'];?\s*$/gm;
const SCRIPT_CONTENT = /<script(?![^>]*\bmodule\b)[^>]*>([\s\S]*?)<\/script>/;

/** What the optimizers logged in this build. */
const logged = { css: [] as unknown[], components: undefined as unknown };
const logger = createLogger();
const loggerInfo = logger.info;
logger.info = (message, options) => {
  const css = OPTIMIZED_CSS.exec(message);
  if (css) {
    const [, file, before, after, percent] = css;
    logged.css.push({
      file: path.basename(file),
      before,
      after,
      percent: Number(percent),
    });
  }
  const rewrote = REWROTE.exec(message);
  if (rewrote)
    logged.components = {
      rewritten: Number(rewrote[1]),
      edits: Number(rewrote[2]),
    };
  loggerInfo(message, options);
};

function buildReport() {
  const id = "virtual:build-report";
  return {
    name: "playground-build-report",
    resolveId: (source: string) => (source === id ? `\0${id}` : undefined),
    async load(
      this: { addWatchFile: (file: string) => void },
      resolved: string,
    ) {
      if (resolved !== `\0${id}`) return;
      const snapshot = path.join(HERE, "../tests/__snapshots__/e2e.json");
      this.addWatchFile(snapshot);
      const examples = Object.entries(
        JSON.parse(readFileSync(snapshot, "utf8")) as Record<
          string,
          Record<string, unknown>
        >,
      ).flatMap(([example, entry]) =>
        "before_kb" in entry
          ? [{ example, build: "default", flat: true, ...entry }]
          : Object.entries(entry).map(([build, value]) => ({
              example,
              build,
              ...(value as object),
            })),
      );
      const lastBuild = existsSync(BUILD_REPORT)
        ? JSON.parse(readFileSync(BUILD_REPORT, "utf8"))
        : undefined;
      // optimizeImports on each file's instance script: its Carbon imports
      // before and after.
      const preprocess = optimizeImports();
      const files = [
        ...readdirSync(path.join(HERE, "src"), { recursive: true })
          .map(String)
          // Not the gallery's generated components.
          .filter(
            (file) =>
              /\.(svelte|svx)$/.test(file) && !file.startsWith("gallery"),
          )
          .map((file) => path.join(HERE, "src", file)),
      ].sort();
      const imports = (
        await Promise.all(
          files.map(async (file) => {
            const script = SCRIPT_CONTENT.exec(readFileSync(file, "utf8"))?.[1];
            if (!script) return undefined;
            const out = await preprocess.script?.({
              content: script,
              filename: file,
              attributes: {},
              markup: "",
            });
            const before = script.match(IMPORT_LINE) ?? [];
            const after = (out?.code ?? script).match(IMPORT_LINE) ?? [];
            if (!out || before.join("\n") === after.join("\n"))
              return undefined;
            return {
              file: path.relative(HERE, file),
              before: before.map((line) => line.trim()),
              after: after.map((line) => line.trim()),
            };
          }),
        )
      ).filter(Boolean);
      return `export default ${JSON.stringify({ examples, lastBuild, imports })};`;
    },
    // After a build: what the optimizers logged, and the emitted assets (in
    // kB, as the optimizers log them).
    writeBundle(
      _: unknown,
      bundle: Record<
        string,
        { type: string; code?: string; source?: string | Uint8Array }
      >,
    ) {
      const assets = Object.entries(bundle)
        .map(([file, output]) => ({
          file,
          type: file.endsWith(".css")
            ? "css"
            : file.endsWith(".js")
              ? "js"
              : "other",
          kb:
            Math.round(
              Buffer.byteLength(output.code ?? output.source ?? "") / 10,
            ) / 100,
        }))
        .filter((asset) => asset.type !== "other")
        .sort((a, b) => b.kb - a.kb);
      mkdirSync(path.dirname(BUILD_REPORT), { recursive: true });
      writeFileSync(
        BUILD_REPORT,
        JSON.stringify({
          at: new Date().toISOString(),
          ccs: CCS_DIR ? "checkout" : "installed",
          optimized: OPTIMIZE,
          css: logged.css,
          components: logged.components,
          assets: assets.slice(0, 12),
          totals: {
            js: assets
              .filter((a) => a.type === "js")
              .reduce((sum, a) => sum + a.kb, 0),
            css: assets
              .filter((a) => a.type === "css")
              .reduce((sum, a) => sum + a.kb, 0),
            files: assets.length,
          },
        }),
      );
    },
  };
}

/**
 * `virtual:ccs-pages`: the checkout's docs pages in `CCS_PAGES`, each loaded
 * on demand. A glob would compile every page, and some need docs-only setup.
 */
function ccsPages() {
  const id = "virtual:ccs-pages";
  return {
    name: "playground-ccs-pages",
    resolveId: (source: string) => (source === id ? `\0${id}` : undefined),
    load(resolved: string) {
      if (resolved !== `\0${id}`) return;
      const entries = CCS_PAGE_FILES.map(
        (file) =>
          `  ${JSON.stringify(path.basename(file))}: () => import(${JSON.stringify(file)}),`,
      );
      return `export default {\n${entries.join("\n")}\n};`;
    },
  };
}

/**
 * `virtual:search-index`: every page's title and its h2 and h3 headings,
 * for the header search. Read with `markdownToHtml`, which returns the
 * headings and frontmatter `markdown()` exports, without rendering Svelte.
 */
function searchIndex() {
  const id = "virtual:search-index";
  return {
    name: "playground-search-index",
    resolveId: (source: string) => (source === id ? `\0${id}` : undefined),
    async load(
      this: { addWatchFile: (file: string) => void },
      resolved: string,
    ) {
      if (resolved !== `\0${id}`) return;
      const dir = path.join(HERE, "src/pages");
      const files = [
        ...readdirSync(dir)
          .filter((file) => file.endsWith(".svx"))
          .map((file) => path.join(dir, file)),
        ...CCS_PAGE_FILES,
      ];
      const pages = await Promise.all(
        files.map(async (file) => {
          this.addWatchFile(file);
          const page = path.basename(file, ".svx");
          const { headings, metadata } = await markdownToHtml(
            readFileSync(file, "utf8"),
          );
          return {
            page,
            title: typeof metadata.title === "string" ? metadata.title : page,
            ccs: CCS_PAGE_FILES.includes(file),
            headings: headings
              .filter((h) => h.depth === 2 || h.depth === 3)
              .map(({ id, text }) => ({ id, text })),
          };
        }),
      );
      pages.push({ page: "Matrix", title: "Matrix", ccs: false, headings: [] });
      return `export default ${JSON.stringify(pages)};`;
    },
  };
}

/**
 * `virtual:ccs-api`: a compact component index for the code views' hover
 * cards, from the docs' COMPONENT_API.json (sveld) and each page's
 * frontmatter description. Loaded lazily, on the first hover.
 */
function ccsApi() {
  const id = "virtual:ccs-api";
  return {
    name: "ccs-api",
    resolveId: (source: string) => (source === id ? `\0${id}` : undefined),
    load(resolved: string) {
      if (resolved !== `\0${id}`) return;
      return `export default ${JSON.stringify(apiIndex())};`;
    },
  };
}

type Diagnostic = {
  start: number;
  end: number;
  message: string;
  code?: number;
  severity: "error" | "warning";
};
type View = {
  code: string;
  tokens?: number[];
  cards?: number[];
  diagnostics?: Diagnostic[];
};

/*
 * Type-checked examples. Each example's JSDoc and TypeScript views are
 * written to `.typecheck/examples/<hash>.svelte`; `typecheck-examples.ts`
 * runs svelte-check over them and writes `.typecheck/diagnostics.json`,
 * which views pick up here as squiggles and hover messages.
 */
const CHECK_DIR = path.join(HERE, ".typecheck");
const CHECK_EXAMPLES = path.join(CHECK_DIR, "examples");
const DIAGNOSTICS = path.join(CHECK_DIR, "diagnostics.json");
let checkReady = false;

function setupCheckDir() {
  if (checkReady) return;
  checkReady = true;
  mkdirSync(CHECK_EXAMPLES, { recursive: true });
  const modules = path.join(CHECK_DIR, "node_modules");
  mkdirSync(modules, { recursive: true });
  for (const [name, target] of [
    ["carbon-components-svelte", CCS],
    [
      "carbon-icons-svelte",
      path.join(HERE, "node_modules/carbon-icons-svelte"),
    ],
    ["svelte", path.join(HERE, "node_modules/svelte")],
  ]) {
    // Re-pointed each run: `CCS_DIR` may have changed since the last one.
    const link = path.join(modules, name);
    rmSync(link, { force: true });
    symlinkSync(target, link);
  }
}

/** A diagnostic as `diagnostics.json` stores it: by line and column. */
type StoredDiagnostic = Omit<Diagnostic, "start" | "end"> & {
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
};
let diagnosticsCache:
  | { mtime: number; data: Record<string, StoredDiagnostic[]> }
  | undefined;

/** Register a view for checking, and return its diagnostics from the last check. */
const origins: Record<string, string> = {};

/** Where an example comes from: `ccs:` (a CCS checkout's docs) or `playground:`, and its path. */
function originOf(file: string | undefined): string {
  if (!file) return "playground:?";
  if (DOCS && file.startsWith(DOCS))
    return `ccs:${path.relative(path.join(DOCS, "src/pages"), file)}`;
  return `playground:${path.relative(HERE, file)}`;
}

function checkView(
  code: string,
  kind: "js" | "ts",
  origin: string,
): Diagnostic[] | undefined {
  // Framed examples with local modules need their siblings: not checked yet.
  if (/\bfrom\s+["']\.\.?\//.test(code)) return undefined;
  setupCheckDir();
  const name = `${createHash("sha1").update(code).digest("hex").slice(0, 12)}.${kind}.svelte`;
  const file = path.join(CHECK_EXAMPLES, name);
  if (!existsSync(file)) writeFileSync(file, code);
  // Which page or framed file each example came from, for the report.
  if (origins[name] !== origin) {
    origins[name] = origin;
    writeFileSync(
      path.join(CHECK_DIR, "origins.json"),
      JSON.stringify(origins, null, 1),
    );
  }
  if (!existsSync(DIAGNOSTICS)) return undefined;
  const mtime = statSync(DIAGNOSTICS).mtimeMs;
  if (diagnosticsCache?.mtime !== mtime)
    diagnosticsCache = {
      mtime,
      data: JSON.parse(readFileSync(DIAGNOSTICS, "utf8")),
    };
  const found = diagnosticsCache.data[name];
  if (!found) return [];
  // Line and column to offsets in the view's code.
  const starts = [0];
  for (let i = 0; i < code.length; i++)
    if (code[i] === "\n") starts.push(i + 1);
  return found.map((d) => ({
    start: (starts[d.line] ?? 0) + d.character,
    end: Math.max(
      (starts[d.endLine] ?? 0) + d.endCharacter,
      (starts[d.line] ?? 0) + d.character + 1,
    ),
    message: d.message,
    code: d.code,
    severity: d.severity,
  }));
}

/**
 * Where the hover cards are: `[gap, length, …]` for each token with one, so
 * a code view can underline them before the reader points at anything.
 */
function cardPositions(code: string, lang: string): number[] {
  const { tokens, info } = analyze(
    code,
    lang === "javascript" ? "js" : lang,
    apiIndex(),
  );
  const data: number[] = [];
  let last = 0;
  for (const index of [...info.keys()].sort((a: number, b: number) => a - b)) {
    const token = tokens[index];
    data.push(token.start - last, token.end - token.start);
    last = token.end;
  }
  return data;
}

/**
 * Every view a code view can open with, and its token data, prepared at
 * build time: the source as shown (line markers and prompts removed), and
 * for examples with a script, the JSDoc and TypeScript views. The browser
 * then only paints, and needs the component API only for hover cards.
 */
/**
 * Views for a code view. `check`: type-check the JSDoc and TypeScript views
 * (complete examples only; a fence opts in with `check`).
 */
function prepareViews(
  code: string,
  lang: string,
  meta = "",
  check = false,
  origin = "playground:?",
): Record<string, View> {
  const fence = prepareFence(code, lang, meta);
  const { terminal, meta: parsed } = fence;
  const source = fence.code;
  const views: Record<string, View> = {
    source: {
      code: source,
      tokens: fence.lang ? encodeTokens(source, fence.lang) : undefined,
      cards: terminal || !fence.lang ? [] : cardPositions(source, fence.lang),
    },
  };
  const fixed =
    parsed.marks.size > 0 ||
    parsed.lineNumbers !== undefined ||
    terminal !== undefined;
  if (lang === "svelte" && /<script[\s>]/.test(code) && !fixed) {
    const api = apiIndex();
    for (const [key, typed] of [
      ["js", toJSDoc(code, api)],
      ["ts", toTypeScript(code, api)],
    ] as const) {
      views[key] = {
        code: typed,
        tokens: encodeTokens(typed, "svelte"),
        cards: cardPositions(typed, "svelte"),
        diagnostics:
          check || /(^|\s)check(\s|$)/.test(meta)
            ? checkView(typed, key, origin)
            : undefined,
      };
    }
  }
  return views;
}

const prop = (name: string, value: unknown) =>
  ` ${name}={${JSON.stringify(value)}}`;

type Ctx = Parameters<
  NonNullable<NonNullable<MarkdownOptions["renderers"]>["code"]>
>[1];

/** `icon={…}` and `statusIcon={…}` for a code view, from the build's `codeIcons`. */
function iconProps(ctx: Ctx, code: string, lang: string, meta = ""): string {
  const parsed = parseCodeMeta(meta);
  const terminal = terminalLines(code, lang) !== undefined;
  const icon = ctx.codeIcon({
    type: "file",
    title: parsed.title,
    lang,
    terminal,
    name: parsed.icon,
  });
  const status = parsed.kind
    ? ctx.codeIcon({ type: "status", status: parsed.kind })
    : undefined;
  return `${icon ? ` icon={${icon}}` : ""}${status ? ` statusIcon={${status}}` : ""}`;
}

/** `icons={[…]}` for file tabs. */
function fileIcons(
  ctx: Ctx,
  files: { name: string; lang: string; code: string; meta?: string }[],
): string {
  const names = files.map((f) =>
    ctx.codeIcon({
      type: "file",
      title: f.name,
      lang: f.lang,
      terminal: false,
      name: parseCodeMeta(f.meta ?? "").icon,
    }),
  );
  return names.some(Boolean)
    ? ` icons={[${names.map((n) => n ?? "undefined").join(", ")}]}`
    : "";
}

const shared: MarkdownOptions = {
  // Prose when the CCS in use has it; plain HTML otherwise.
  prose: HAS_PROSE,
  carbonDir: CCS_DIR,
  // Carbon icons in code headers; a site adds its own by wrapping `carbonCodeIcon`.
  codeIcons: carbonCodeIcon,
  highlight,
  anchors: { depths: [2, 3] },
  layout: "/src/Layout.svelte",
  autoImport: {
    DocKbd: "/src/DocKbd.svelte",
    Example: "/src/Example.svelte",
    CodeView: "/src/CodeView.svelte",
  },
  transform(tree) {
    // As the CCS docs do: leading paragraphs become the description (after
    // the page's `<script>`, if it starts with one).
    const intro: string[] = [];
    let at = 0;
    while (
      tree.blocks[at]?.type === "svelte" &&
      SCRIPT_BLOCK.test((tree.blocks[at] as { value: string }).value)
    )
      at++;
    // After a script, only without a frontmatter description (Kitchen sink
    // has both, and keeps its first paragraphs in the page).
    const after = at > 0;
    while (
      (!after || tree.metadata.description === undefined) &&
      tree.blocks[at]?.type === "paragraph"
    ) {
      intro.push((tree.blocks.splice(at, 1)[0] as { text: string }).text);
    }
    if (intro.length) tree.metadata.description = intro.join(" ");
    // A page's `title` frontmatter, else its file name.
    tree.metadata.title ??= path
      .basename(tree.filename ?? "")
      .replace(/\.(svx|md)$/, "");
  },
  renderers: {
    svelte(block, ctx) {
      const value = block.value;
      // A page that is an app (`examples: false`) renders its components as is.
      if (ctx.metadata.examples === false) return value;
      if (value.startsWith("<FileSource")) {
        const src = FILE_SOURCE_SRC.exec(value)?.[1] ?? "";
        const files = framedFiles(src);
        const code =
          files.length > 1
            ? prop("files", files) + fileIcons(ctx, files)
            : files.length
              ? prop("code", files[0].code) +
                prop("views", files[0].views) +
                iconProps(ctx, files[0].code, "svelte")
              : "";
        return `<Example frame="${src.split("/").pop()}"${code} />`;
      }
      if (value.startsWith("<DocKbd")) return `<p>${value}</p>`;
      if (/^<(details|dl|figure)\b/.test(value)) return value;
      if (value.startsWith("{") || value.startsWith("<!--")) return value;
      const example = ctx.example(value);
      return `<Example${prop("code", example)}${prop("views", prepareViews(example, "svelte", "", true, originOf(ctx.filename)))}${iconProps(ctx, example, "svelte")}>${value}</Example>`;
    },
    // `::: code-group`: one code view with a tab per block.
    async codeGroup(block, ctx) {
      // Do and don't, side by side: each block is its own code view.
      if (block.layout === "compare")
        return `<div class="code-compare">\n${await ctx.render(block.children)}\n</div>`;
      const blocks = block.children;
      if (!blocks.every((child) => child.type === "code")) return undefined;
      const files = blocks.map((child, i) => ({
        name:
          parseCodeMeta(child.meta).title ?? (child.lang || `File ${i + 1}`),
        lang: child.lang || "text",
        code: child.value.replace(/\n$/, ""),
        meta: child.meta,
      }));
      for (const f of files)
        Object.assign(f, { views: prepareViews(f.code, f.lang, f.meta) });
      return `<CodeView files={${JSON.stringify(files)}}${fileIcons(ctx, files)}${block.group ? prop("group", block.group) : ""} />`;
    },
    // Fenced code renders in a code view too: hover cards, JS/TS switch.
    code(block, ctx) {
      const lang = block.lang || "text";
      const code = block.value.replace(/\n$/, "");
      return `<CodeView lang=${JSON.stringify(lang)}${prop("code", code)}${block.meta ? prop("meta", block.meta) : ""}${prop("views", prepareViews(code, lang, block.meta, false, originOf(ctx.filename)))}${iconProps(ctx, code, lang, block.meta)} />`;
    },
  },
};

/** The `.svx` pages' preprocessor: one Prose per run of Markdown. */
const svxPages = markdown({
  ...shared,
  extensions: [".svx"],
  proseScope: "markdown",
});

/**
 * `virtual:page-sources`: for each page, a loader for its Markdown and the
 * Svelte component `markdown()` compiles it to (through `svxPages` itself,
 * so it's exactly what Svelte gets). Each page's is its own module, loaded
 * when a reader opens the source view.
 */
function pageSources() {
  const index = "virtual:page-sources";
  const prefix = "virtual:page-source/";
  const pageFiles = () => {
    const dir = path.join(HERE, "src/pages");
    return new Map(
      [
        ...readdirSync(dir)
          .filter((file) => file.endsWith(".svx"))
          .map((file) => path.join(dir, file)),
        ...CCS_PAGE_FILES,
      ].map((file) => [path.basename(file, ".svx"), file]),
    );
  };
  return {
    name: "playground-page-sources",
    resolveId: (source: string) =>
      source === index || source.startsWith(prefix) ? `\0${source}` : undefined,
    async load(
      this: { addWatchFile: (file: string) => void },
      resolved: string,
    ) {
      if (resolved === `\0${index}`) {
        const entries = [...pageFiles().keys()].map(
          (page) =>
            `  ${JSON.stringify(page)}: () => import(${JSON.stringify(`${prefix}${page}`)}),`,
        );
        return `export default {\n${entries.join("\n")}\n};`;
      }
      if (!resolved.startsWith(`\0${prefix}`)) return;
      const file = pageFiles().get(resolved.slice(prefix.length + 1));
      if (!file) return "export default undefined;";
      this.addWatchFile(file);
      const markdownSource = readFileSync(file, "utf8");
      const compiled = await svxPages.markup?.({
        content: markdownSource,
        filename: file,
      });
      // Token data from the build, as the pages' code views get: thousands
      // of lines would freeze the browser tokenizing them.
      const page = path.basename(file, ".svx");
      const views = (code: string, title: string) =>
        prepareViews(code, "svelte", `title="${title}" showLineNumbers`);
      return `export default ${JSON.stringify({
        markdown: views(markdownSource, `${page}.svx`),
        svelte: views(compiled?.code ?? "", "Compiled by markdown()"),
      })};`;
    },
  };
}

export default {
  // Records what the optimizers log, for the build report.
  customLogger: logger,
  plugins: [
    // Before svelte(): it hands Svelte Carbon's components rewritten for the
    // props this app passes (builds only; see OPTIMIZE).
    ...(OPTIMIZE
      ? [
          optimizeComponents({
            content: ["src/**/*.{svelte,svx,md,sample,js,ts}"],
          }),
        ]
      : []),
    ccsApi(),
    searchIndex(),
    pageSources(),
    buildReport(),
    svelte({
      extensions: [".svelte", ".svx", ".md", ".sample"],
      preprocess: [
        svxPages,
        markdown({ ...shared, extensions: [".md"], proseScope: "page" }),
        // Matrix samples: one element group each, no layout.
        markdown({
          extensions: [".sample"],
          prose: HAS_PROSE,
          carbonDir: CCS_DIR,
          anchors: { depths: [2, 3, 4] },
          highlight,
          autoImport: { DocKbd: "/src/DocKbd.svelte" },
        }),
        vitePreprocess(),
        optimizeImports(),
      ],
    }),
    // Prune Carbon CSS the build doesn't use, down to the prop variants it
    // renders (the e2e snapshot records it; see OPTIMIZE).
    ...(OPTIMIZE ? [optimizeCss({ propAware: true })] : []),
    stressPage(),
    optionsGallery(),
    ccsPages(),
    noLocalPaths(),
    restartOnLibraryBuild(),
  ],
  // What the app shows about the CCS in use (a banner when it has no Prose).
  define: {
    __PLAYGROUND__: JSON.stringify({
      prose: HAS_PROSE,
      // A version, never a path: the build shouldn't say where it was built.
      ccs: `carbon-components-svelte@${CCS_VERSION} (${CCS_DIR ? "checkout" : "installed"})`,
    }),
  },
  // Every Carbon component, every page: big chunks are expected here.
  build: { chunkSizeWarningLimit: 4000 },
  resolve: {
    alias: {
      ...(CCS_DIR ? { "carbon-components-svelte": CCS_DIR } : {}),
      "@icons": path.join(HERE, "node_modules/carbon-icons-svelte/lib"),
    },
    dedupe: ["svelte"],
    // Keep `.md` symlinks as `.md`, so they compile with the page scope.
    preserveSymlinks: true,
  },
  server: {
    fs: { allow: [HERE, path.join(HERE, ".."), ...(CCS_DIR ? [CCS_DIR] : [])] },
  },
  optimizeDeps: {
    exclude: ["carbon-components-svelte", "carbon-icons-svelte"],
  },
};
