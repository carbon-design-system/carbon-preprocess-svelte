import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { BunPlugin } from "bun";
import { compile } from "svelte/compiler";
import { specializeFiles } from "../../src/specializer/analysis";
import type { LibrarySpec } from "../../src/specializer/library";

/** A library that isn't Carbon, as the specializer reads it. */
const MYLIB: LibrarySpec = {
  name: "mylib",
  srcDir: "src",
  barrel: "index.js",
  componentPackages: [],
  contextKeyPrefix: "mylib:",
  label: "MyLib",
  tool: "mylib-plugin",
};

/** An app and the library it renders, as files. */
export type LibraryApp = {
  /** Files in the library's `src/`; its top-level `.svelte` files are its barrel's exports. */
  lib: Record<string, string>;
  /** Files in the app's `src/`; `App.svelte` is rendered. */
  app: Record<string, string>;
  /** Other installed packages' files, by package name; `index.js` is each one's entry. */
  packages?: Record<string, Record<string, string>>;
};

const SVELTE_FILE = /\.svelte$/;
const COMMENT = /<!--[^>]*-->/g;
const WHITESPACE = /\s+/g;
const TAG_NAME = /<([A-Z]\w*)/g;

// Inside this repo, so the library resolves its `svelte` (and the app its
// runtime), as an installed one would.
const CACHE = path.join(import.meta.dir, "../../node_modules/.cache");

function writeProject({ lib, app, packages = {} }: LibraryApp) {
  mkdirSync(CACHE, { recursive: true });
  const root = mkdtempSync(path.join(CACHE, "render-library-"));
  const pkg = path.join(root, "node_modules", MYLIB.name);
  const write = (file: string, code: string) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, code);
  };
  const barrel: string[] = [];
  for (const [file, code] of Object.entries(lib)) {
    write(path.join(pkg, "src", file), code);
    if (file.endsWith(".svelte") && !file.includes("/")) {
      const name = path.basename(file, ".svelte");
      barrel.push(`export { default as ${name} } from "./${file}";`);
    }
  }
  write(path.join(pkg, "src/index.js"), barrel.join("\n"));
  write(
    path.join(pkg, "package.json"),
    JSON.stringify({
      name: MYLIB.name,
      version: "1.0.0",
      type: "module",
      svelte: "./src/index.js",
      exports: { ".": "./src/index.js" },
    }),
  );
  for (const [name, files] of Object.entries(packages)) {
    const dir = path.join(root, "node_modules", name);
    for (const [file, code] of Object.entries(files)) {
      write(path.join(dir, file), code);
    }
    write(
      path.join(dir, "package.json"),
      JSON.stringify({
        name,
        version: "1.0.0",
        type: "module",
        main: "index.js",
      }),
    );
  }
  const files = Object.entries(app).map(([file, code]) => {
    write(path.join(root, "src", file), code);
    return { file: path.join(root, "src", file), code };
  });
  return { root, files };
}

/** Compiles `.svelte` files for SSR, `overrides` (by real path) in place of their source. */
function svelteServer(overrides: ReadonlyMap<string, string>): BunPlugin {
  return {
    name: "svelte-server",
    setup(build) {
      build.onLoad({ filter: SVELTE_FILE }, async ({ path: file }) => ({
        contents: compile(
          overrides.get(realpathSync(file)) ?? (await Bun.file(file).text()),
          { filename: file, generate: "server" },
        ).js.code,
        loader: "js",
      }));
    },
  };
}

let renders = 0;

/** `App.svelte`'s SSR HTML, hydration comments removed and whitespace collapsed. */
async function render(root: string, overrides: ReadonlyMap<string, string>) {
  const dir = path.join(root, `ssr-${renders++}`);
  const entry = path.join(dir, "entry.ts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    entry,
    [
      `import App from ${JSON.stringify(path.join(root, "src/App.svelte"))};`,
      'import { render } from "svelte/server";',
      "export const html = render(App).body;",
    ].join("\n"),
  );
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: dir,
    // Not `.js`: Bun would resolve `entry.js` to the `entry.ts` beside it.
    naming: "[name].mjs",
    target: "bun",
    plugins: [svelteServer(overrides)],
  });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
  const output = result.outputs.find((o) => o.path.endsWith(".mjs"));
  const { html } = (await import(output?.path ?? "")) as { html: string };
  return html.replace(COMMENT, "").replace(WHITESPACE, " ").trim();
}

async function specialize(
  root: string,
  files: Array<{ file: string; code: string }>,
  options: { unwrap: boolean },
) {
  const result = await specializeFiles({
    library: MYLIB,
    projectRoot: root,
    files,
    failure: { feature: "specialize", fallback: "nothing was rewritten" },
    options,
  });
  if ("warning" in result) throw new Error(result.warning);
  return result;
}

/**
 * Specializes `shape`'s library (and app components) for its app, then
 * SSR-renders the app with the original and the rewritten sources.
 */
export async function renderSpecialized(
  shape: LibraryApp,
  options: { unwrap: boolean },
): Promise<{ before: string; after: string; edits: number }> {
  const { root, files } = writeProject(shape);
  try {
    const result = await specialize(root, files, options);
    const overrides = new Map(
      [...result.sources].map(([file, { code }]) => [file, code]),
    );
    return {
      before: await render(root, new Map()),
      after: await render(root, overrides),
      edits: result.edits,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** `shape`'s library files as specialized for its app, by path in its `src/`. */
export async function specializedLibrary(
  shape: LibraryApp,
): Promise<Record<string, string>> {
  const { root, files } = writeProject(shape);
  try {
    const result = await specialize(root, files, { unwrap: false });
    const src = realpathSync(
      path.join(root, "node_modules", MYLIB.name, "src"),
    );
    const sources: Record<string, string> = {};
    for (const [file, { code }] of result.sources) {
      if (file.startsWith(src)) sources[path.relative(src, file)] = code;
    }
    return sources;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** An `App.svelte` that imports the library components `markup` renders. */
export function appRendering(
  markup: string,
  script = "",
): Record<string, string> {
  const names = [
    ...new Set([...markup.matchAll(TAG_NAME)].map(([, name]) => name)),
  ].filter((name) => !script.includes(`import ${name} `));
  const imports = names.length
    ? `import { ${names.join(", ")} } from "${MYLIB.name}";\n`
    : "";
  return {
    "App.svelte": `<script>\n${imports}${script}\n</script>\n${markup}`,
  };
}
