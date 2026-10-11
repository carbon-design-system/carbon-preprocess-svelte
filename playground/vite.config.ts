// The playground: carbon-preprocess-svelte's own docs-site testbed. Pages go
// through markdown() (the kitchen sink twice: `.svx` with one Prose per
// Markdown run, `.md`, a symlink, with one Prose for the page), imports
// through optimizeImports(), and the build through optimizeCss(). Code views
// use the browser-safe `carbon-preprocess-svelte/code`.
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
import path from "node:path";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
// The built-in highlighter: Carbon syntax tokens, no Prism.
import {
  carbonCodeIcon,
  encodeTokens,
  highlight,
  type MarkdownOptions,
  markdown,
  optimizeCss,
  optimizeImports,
  parseCodeMeta,
  prepareFence,
  terminalLines,
} from "carbon-preprocess-svelte";
import { sveld } from "sveld";
import { loadEnv } from "vite";
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
const CCS_VERSION: string = JSON.parse(
  readFileSync(path.join(CCS, "package.json"), "utf8"),
).version;
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
      const dir = DOCS && path.join(DOCS, "src/pages/components");
      const pages = dir
        ? CCS_PAGES.filter((name) => existsSync(path.join(dir, `${name}.svx`)))
        : [];
      const entries = pages.map(
        (name) =>
          `  ${JSON.stringify(`${name}.svx`)}: () => import(${JSON.stringify(path.join(dir ?? "", `${name}.svx`))}),`,
      );
      return `export default {\n${entries.join("\n")}\n};`;
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
    // As the CCS docs do: leading paragraphs become the description.
    const intro: string[] = [];
    while (tree.blocks[0]?.type === "paragraph") {
      intro.push((tree.blocks.shift() as { text: string }).text);
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

export default {
  plugins: [
    ccsApi(),
    svelte({
      extensions: [".svelte", ".svx", ".md", ".sample"],
      preprocess: [
        markdown({ ...shared, extensions: [".svx"], proseScope: "markdown" }),
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
    // Prune Carbon CSS the build doesn't use (the e2e snapshot records it).
    optimizeCss(),
    stressPage(),
    ccsPages(),
  ],
  // What the app shows about the CCS in use (a banner when it has no Prose).
  define: {
    __PLAYGROUND__: JSON.stringify({
      prose: HAS_PROSE,
      ccs: CCS_DIR ?? `carbon-components-svelte@${CCS_VERSION} (installed)`,
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
