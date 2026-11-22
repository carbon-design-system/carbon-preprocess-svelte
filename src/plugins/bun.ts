import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { isSvelteFile } from "../utils";
import {
  type CarbonBuildModule,
  type CarbonOptimizer,
  type CarbonOptimizerOptions,
  createCarbonOptimizer,
  type RewrittenComponent,
} from "./carbon-optimizer";

/**
 * The parts of `Bun.build`'s result this reads. Declared here, not
 * imported from `bun`, so the published types need no `@types/bun`.
 */
type BunBuildResult = {
  outputs: ReadonlyArray<{ path: string; hash: string | null }>;
  metafile?: {
    inputs: Record<
      string,
      {
        imports: ReadonlyArray<{
          path: string;
          kind: string;
          original?: string;
          entryPoint?: string;
          external?: boolean;
        }>;
      }
    >;
    outputs: Record<string, { entryPoint?: string }>;
  };
};

export type CarbonBunOptions = CarbonOptimizerOptions & {
  /**
   * How Carbon's stylesheets (`carbon-components-svelte/css/*.css`) reach
   * the build. `"raw"` keeps them out of Bun's CSS bundler, which lowers
   * modern syntax for old browsers (a quarter more CSS for `all.css`), and
   * prunes the file as Carbon ships it into the CSS that imported it.
   * `"bundled"` leaves them to Bun.
   * @default "raw"
   */
  stylesheet?: "raw" | "bundled";
};

export type CarbonBunPlugin = {
  name: string;
  setup(build: {
    onStart(callback: () => void | Promise<void>): unknown;
    onLoad(
      options: { filter: RegExp },
      callback: (args: { path: string }) => { contents: string; loader: "css" },
    ): unknown;
  }): void;
  /**
   * The rewritten source of `.svelte` file `path`, for your Svelte plugin's
   * `onLoad` to compile instead of the file's; `undefined` to compile the
   * file as it is.
   */
  load(path: string): RewrittenComponent | undefined;
  /**
   * After `Bun.build` (with `metafile: true`): checks the build, then
   * prunes the CSS files it wrote, in place. One whose name holds its
   * content hash is renamed for the pruned content, and the build's other
   * files that name it are updated. Returns the renamed files, old path
   * to new.
   */
  pruneBuild(result: BunBuildResult): Promise<Record<string, string>>;
  /**
   * After `Bun.build` (with `metafile: true`): checks the build, then
   * returns `css` pruned for it, by the same names, leaving its files as
   * they are. For CSS the build didn't bundle: Carbon's stylesheet, inlined
   * into the page.
   */
  pruneCss(
    css: Record<string, string>,
    result: BunBuildResult,
  ): Promise<Record<string, string>>;
};

/** A Bun metafile path: relative to the working directory, or `namespace:path`. */
const RE_NAMESPACED = /^[a-z][\w-]+:/i;
const RE_TEXT_OUTPUT = /\.(?:css|html?|[cm]?js|svg|json)$/;
const RE_CSS_OUTPUT = /\.css$/;
const RE_CARBON_SHEET =
  /[\\/]carbon-components-svelte[\\/]css[\\/][^\\/]+\.css$/;
/** What a raw stylesheet bundles as: one rule Bun's minifier keeps, numbered. */
const SHEET_MARKER = "carbon-preprocess-svelte-sheet";
const RE_SHEET_MARKER = new RegExp(
  `\\.${SHEET_MARKER}-(\\d+)\\s*\\{[^}]*\\}`,
  "g",
);

const absolute = (input: string) =>
  RE_NAMESPACED.test(input) ? input : path.resolve(input);

/**
 * Bun's resolver, for aliased imports (`$lib/Card.svelte`): `import.meta`
 * can't say how the build resolves, and this runs only under Bun.
 */
function resolveWithBun(
  specifier: string,
  importer: string,
): Promise<string | undefined> {
  const bun = (
    globalThis as {
      Bun?: { resolveSync(specifier: string, from: string): string };
    }
  ).Bun;
  try {
    return Promise.resolve(
      bun
        ? bun.resolveSync(specifier, path.dirname(importer))
        : createRequire(importer).resolve(specifier),
    );
  } catch {
    return Promise.resolve(undefined);
  }
}

/**
 * The modules a Bun build bundled, from its metafile, with their sources:
 * a component `optimizer` rewrote as it served it.
 */
function buildModules(
  result: BunBuildResult,
  optimizer: CarbonOptimizer,
): CarbonBuildModule[] {
  const { metafile } = result;
  if (!metafile || typeof metafile !== "object") {
    throw new Error(
      "carbon-preprocess-svelte: optimizeCarbonBun needs the build's metafile: pass `metafile: true` to Bun.build.",
    );
  }
  // A chunk an `import()` loads has an entry point too, but it's imported.
  const dynamic = new Set<string>();
  for (const input of Object.values(metafile.inputs)) {
    for (const { kind, entryPoint } of input.imports) {
      if (kind === "dynamic-import" && entryPoint) dynamic.add(entryPoint);
    }
  }
  const entries = new Set(
    Object.values(metafile.outputs).flatMap(({ entryPoint }) =>
      entryPoint && !dynamic.has(entryPoint) ? [absolute(entryPoint)] : [],
    ),
  );
  return Object.entries(metafile.inputs).map(([input, { imports }]) => {
    const id = absolute(input);
    const code = isSvelteFile(id)
      ? (optimizer.load(id)?.code ?? readText(id))
      : readText(id);
    return {
      id,
      code,
      entry: entries.has(id),
      imports: imports.flatMap((edge) => {
        // An `import()` of another output names the input it was built from.
        const target = edge.external ? edge.entryPoint : edge.path;
        if (!target) return [];
        return [
          {
            id: absolute(target),
            specifier: edge.original,
            dynamic: edge.kind === "dynamic-import",
          },
        ];
      }),
    };
  });
}

function readText(id: string): string | undefined {
  if (RE_NAMESPACED.test(id) || !existsSync(id)) return undefined;
  try {
    return readFileSync(id, "utf8");
  } catch {
    return undefined;
  }
}

/** The text files a Bun build wrote, by path. */
function textOutputs(result: BunBuildResult): Map<string, string> {
  const outputs = new Map<string, string>();
  for (const { path: file } of result.outputs) {
    if (RE_TEXT_OUTPUT.test(file) && existsSync(file)) {
      outputs.set(file, readFileSync(file, "utf8"));
    }
  }
  return outputs;
}

/** `hash` in `file`'s name replaced by one of `css`, of the same length. */
function rehash(file: string, hash: string, css: string): string | undefined {
  const name = path.basename(file);
  if (!hash || !name.includes(hash)) return undefined;
  const next = createHash("sha256")
    .update(css)
    .digest("hex")
    .slice(0, hash.length);
  return next === hash
    ? undefined
    : path.join(path.dirname(file), name.replace(hash, next));
}

/**
 * `optimizeComponents` and `optimizeCss` for `Bun.build`, which has no
 * hooks to run them in: Bun runs only the first `onLoad` that matches a
 * file, so your Svelte plugin compiles what `load` returns, and the CSS is
 * pruned once the build is done. Carbon's stylesheets are pruned as Carbon
 * ships them, not as Bun's CSS bundler rewrites them (`stylesheet`).
 *
 * @example
 * const carbon = optimizeCarbonBun();
 * const result = await Bun.build({
 *   entrypoints: ["index.html"],
 *   outdir: "dist",
 *   metafile: true,
 *   plugins: [carbon, svelte({ carbon })],
 * });
 * await carbon.pruneBuild(result);
 */
export function optimizeCarbonBun(options?: CarbonBunOptions): CarbonBunPlugin {
  const { stylesheet = "raw", ...optimizerOptions } = options ?? {};
  const optimizer = createCarbonOptimizer(optimizerOptions);
  // The raw stylesheets the build imported, by marker number.
  const sheets: string[] = [];

  /** `css` with each stylesheet marker replaced by the file it stands for. */
  const withSheets = (css: string) =>
    css.replace(RE_SHEET_MARKER, (_, i: string) =>
      readFileSync(sheets[Number(i)], "utf8"),
    );

  const finish = async (
    result: BunBuildResult,
    css: Record<string, string>,
    output: Record<string, string>,
  ) =>
    optimizer.finish({
      modules: buildModules(result, optimizer),
      css: Object.fromEntries(
        Object.entries(css).map(([id, text]) => [id, withSheets(text)]),
      ),
      output,
    });

  return {
    name: "carbon-preprocess-svelte",
    setup(build) {
      build.onStart(() => optimizer.prepare(resolveWithBun));
      if (stylesheet === "raw") {
        build.onLoad({ filter: RE_CARBON_SHEET }, ({ path: file }) => {
          let i = sheets.indexOf(file);
          if (i === -1) i = sheets.push(file) - 1;
          return {
            contents: `.${SHEET_MARKER}-${i}{--${SHEET_MARKER}:${i}}`,
            loader: "css",
          };
        });
      }
    },
    load: (file) => optimizer.load(file),
    async pruneCss(css, result) {
      return finish(result, css, Object.fromEntries(textOutputs(result)));
    },
    async pruneBuild(result) {
      const outputs = textOutputs(result);
      const written: Record<string, string> = {};
      const others: Record<string, string> = {};
      for (const [file, text] of outputs) {
        if (RE_CSS_OUTPUT.test(file)) written[file] = text;
        else others[file] = text;
      }
      const pruned = await finish(result, written, others);

      const renamed: Record<string, string> = {};
      for (const { path: file, hash } of result.outputs) {
        const css = pruned[file];
        if (css === undefined || css === written[file]) continue;
        const next = rehash(file, hash ?? "", css);
        writeFileSync(file, css);
        if (!next) continue;
        renameSync(file, next);
        renamed[file] = next;
      }
      // The pages and scripts that link a renamed stylesheet, by its name.
      for (const [file, text] of outputs) {
        if (RE_CSS_OUTPUT.test(file)) continue;
        let next = text;
        for (const [from, to] of Object.entries(renamed)) {
          next = next.replaceAll(path.basename(from), path.basename(to));
        }
        if (next !== text) writeFileSync(file, next);
      }
      return renamed;
    },
  };
}
