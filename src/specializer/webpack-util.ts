import type { LibraryImport } from "./library-paths";

/**
 * Structural subset of a webpack/Rspack module and its incoming
 * connections, so plugins work with either bundler without depending on
 * either package.
 */
export type WebpackModule = {
  resource?: unknown;
  /** On `NormalModule`: the loader output. */
  originalSource?: () => { source(): string | Buffer } | null | undefined;
};

export type WebpackConnection = {
  originModule?: WebpackModule | null;
  /** `request` is the specifier the import was written with. */
  dependency?: { type?: string; request?: unknown } | null;
};

/**
 * Whether a webpack/Rspack compiler builds for production. Plugins apply
 * before the bundler fills in its defaults, and an unset `mode` defaults
 * to `"production"`.
 */
export function isProduction(compiler: {
  options: { mode?: string };
}): boolean {
  return (compiler.options.mode ?? "production") === "production";
}

/** The loader output of `module`, if it has one as text. */
export function moduleSource(module: WebpackModule): string | undefined {
  let source: string | Buffer | undefined;
  try {
    source = module.originalSource?.()?.source();
  } catch {
    // Some module types throw when asked for a source.
  }
  return typeof source === "string" || Buffer.isBuffer(source)
    ? source.toString()
    : undefined;
}

/** The edges into library module `id` from modules with a file. */
export function importEdges(
  id: string,
  connections: Iterable<WebpackConnection>,
): LibraryImport[] {
  const edges: LibraryImport[] = [];
  for (const connection of connections) {
    const importer = connection.originModule?.resource;
    const request = connection.dependency?.request;
    if (typeof importer === "string") {
      edges.push({
        id,
        importer,
        specifier: typeof request === "string" ? request : undefined,
      });
    }
  }
  return edges;
}
