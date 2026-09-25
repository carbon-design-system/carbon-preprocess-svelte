import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { parse } from "svelte/compiler";

export type SvelteParser = typeof parse;

type SvelteCompilerModule = {
  parse?: SvelteParser;
  default?: { parse?: SvelteParser };
};

async function importParser(specifier: string): Promise<SvelteParser> {
  const compiler: SvelteCompilerModule = await import(specifier);
  // Resolving from the project picks the `require` condition, so the module
  // may be CommonJS, whose exports Node exposes under `default`.
  const parse = compiler.parse ?? compiler.default?.parse;
  if (typeof parse !== "function") {
    throw new Error(`"${specifier}" does not export a Svelte parser.`);
  }
  return parse;
}

/**
 * `svelte/compiler` is loaded on demand, never at module scope: this package
 * declares no dependency on `svelte` (bundling the compiler would defeat the
 * point, and a peer dependency would be paid by consumers who never index).
 * The dynamic import stays dynamic in `dist/`, so loading the package never
 * touches the compiler.
 *
 * Resolved from the consuming project (`from`, defaulting to the working
 * directory) first, so the project's own `svelte` parses Carbon even where
 * this package can't see it: Yarn PnP, or pnpm with hoisting disabled, where
 * an undeclared dependency doesn't resolve from this package's location.
 * Falls back to resolving from this package's own install location.
 */
export async function loadSvelteParser(
  from: string = process.cwd(),
): Promise<SvelteParser> {
  let projectCompiler: string | undefined;
  try {
    // `createRequire` wants a module filename; it need not exist on disk.
    projectCompiler = createRequire(path.join(from, "__resolve__.js")).resolve(
      "svelte/compiler",
    );
  } catch {
    // Not resolvable from the project; try this package's location below.
  }

  if (projectCompiler) {
    return importParser(pathToFileURL(projectCompiler).href);
  }

  return importParser("svelte/compiler");
}
