import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Failure } from "./analysis";
import { type LibrarySpec, libraryPaths } from "./library";
import {
  createComponentOptimizer,
  type ImportResolver,
  type SpecializerOptions,
} from "./optimizer";
import { optimizerRegistry } from "./registry";
import { isProduction } from "./webpack-mode";

/**
 * Structural subset of the webpack/Rspack `Compiler` and `Compilation` APIs
 * this plugin uses, so it works with either bundler without depending on
 * either package.
 */
type WebpackModule = {
  resource?: unknown;
  /** On `NormalModule`: the loader output. */
  originalSource?: () => { source(): string | Buffer } | null | undefined;
};

type AsyncHook = {
  tapPromise(name: string, callback: () => Promise<void>): void;
};

type WebpackConnection = {
  originModule?: WebpackModule | null;
  /** `request` is the specifier the import was written with. */
  dependency?: { type?: string; request?: unknown } | null;
};

type WebpackCompilation = {
  moduleGraph: {
    getIncomingConnections(module: WebpackModule): Iterable<WebpackConnection>;
  };
  hooks: {
    finishModules: {
      tap(
        name: string,
        callback: (modules: Iterable<WebpackModule>) => void,
      ): void;
    };
  };
  warnings: { push(error: Error): void };
  errors: { push(error: Error): void };
};

export type WebpackCompiler = {
  options: { mode?: string; module: { rules: unknown[] } };
  context: string;
  webpack: { WebpackError: new (message: string) => Error };
  hooks: {
    beforeRun: AsyncHook;
    watchRun: AsyncHook;
    /** webpack 5.40+ and Rspack. */
    shutdown?: { tap(name: string, callback: () => void): void };
    thisCompilation: {
      tap(
        name: string,
        callback: (compilation: WebpackCompilation) => void,
      ): void;
    };
  };
  getInfrastructureLogger(name: string): { info(message: string): void };
  resolverFactory?: {
    get(type: "normal"): {
      resolve(
        context: object,
        path: string,
        request: string,
        resolveContext: object,
        callback: (error: Error | null, result?: string | false) => void,
      ): void;
    };
  };
};

const SVELTE_FILE = /\.svelte$/;

/** The compiler's resolver, for aliased imports; `undefined` if it has none. */
function resolveWith(compiler: WebpackCompiler): ImportResolver | undefined {
  let resolver: ReturnType<
    NonNullable<WebpackCompiler["resolverFactory"]>["get"]
  >;
  try {
    const factory = compiler.resolverFactory;
    if (!factory) return undefined;
    resolver = factory.get("normal");
  } catch {
    return undefined;
  }
  return (source, importer) =>
    new Promise((resolve) => {
      try {
        resolver.resolve(
          {},
          path.dirname(importer),
          source,
          {},
          (error, result) => resolve(error || !result ? undefined : result),
        );
      } catch {
        resolve(undefined);
      }
    });
}

/**
 * `specializerPlugin` for webpack and Rspack: rewrites each component of
 * `spec`'s library the app renders for the props it passes.
 *
 * Runs on production builds only. It adds `loader` (see
 * `specializer/loader`) before `svelte-loader` on `.svelte` files, and
 * fails the build if a module outside `content` imports one of the
 * library's components.
 */
export class SpecializerWebpackPlugin {
  private spec: LibrarySpec;
  private options: SpecializerOptions;
  private names: {
    /** Names the plugin in messages and webpack's hooks. */
    plugin: string;
    /** What a failed analysis turns off, for its warning. */
    failure: Failure;
    /** The built loader's path. */
    loader: string;
  };

  public constructor(
    spec: LibrarySpec,
    options: SpecializerOptions | undefined,
    names: SpecializerWebpackPlugin["names"],
  ) {
    this.spec = spec;
    this.options = { ...options };
    this.names = names;
  }

  public apply(compiler: WebpackCompiler) {
    // Production builds only, like `optimizeComponents`: the analysis
    // runs for the whole app up front, and the dev server's rebuilds of
    // single modules would leave rewritten components stale.
    if (!isProduction(compiler)) return;

    const { WebpackError } = compiler.webpack;
    const { spec } = this;
    const name = this.names.plugin;
    const library = libraryPaths(spec);
    const optimizer = createComponentOptimizer(spec, this.options, this.names);
    // Unique across copies of this package, which share the registry.
    const id = randomUUID();
    optimizerRegistry().set(id, optimizer);
    compiler.hooks.shutdown?.tap(name, () => {
      optimizerRegistry().delete(id);
    });

    // A pre-loader runs before normal loaders, so `svelte-loader` compiles
    // the rewritten source wherever this plugin sits in `plugins`. Every
    // `.svelte` file: which of the app's own get rewritten depends on the
    // analysis, and the loader passes the rest through.
    compiler.options.module.rules.push({
      test: SVELTE_FILE,
      enforce: "pre",
      use: [{ loader: this.names.loader, options: { id } }],
    });

    let warning: string | undefined;
    const prepare = async () => {
      const result = await optimizer.prepare(
        compiler.context,
        resolveWith(compiler),
      );
      warning = result.warning;
      if (result.info) compiler.getInfrastructureLogger(name).info(result.info);
      for (const line of result.report ?? []) console.log(line);
    };
    compiler.hooks.beforeRun.tapPromise(name, prepare);
    compiler.hooks.watchRun.tapPromise(name, prepare);

    compiler.hooks.thisCompilation.tap(name, (compilation) => {
      if (warning) compilation.warnings.push(new WebpackError(warning));
      compilation.hooks.finishModules.tap(name, (modules) => {
        for (const module of modules) {
          const resource = module.resource;
          if (typeof resource !== "string") continue;
          let source: string | Buffer | undefined;
          try {
            source = module.originalSource?.()?.source();
          } catch {
            // Some module types throw when asked for a source.
          }
          if (typeof source === "string" || Buffer.isBuffer(source)) {
            optimizer.check(resource, source.toString(), compiler.context);
          }
          // Every import of the library, as the module graph has it: check
          // the analysis read each one.
          if (library.importKey(resource)) {
            for (const connection of compilation.moduleGraph.getIncomingConnections(
              module,
            )) {
              const origin = connection.originModule?.resource;
              const request = connection.dependency?.request;
              if (typeof origin === "string") {
                optimizer.checkLibraryImport(
                  {
                    id: resource,
                    importer: origin,
                    specifier:
                      typeof request === "string" ? request : undefined,
                  },
                  compiler.context,
                );
              }
            }
            continue;
          }
          if (optimizer.isClosed(resource)) {
            const importers: Array<string | undefined> = [];
            let dynamic = false;
            for (const connection of compilation.moduleGraph.getIncomingConnections(
              module,
            )) {
              const origin = connection.originModule;
              if (origin === module) continue;
              importers.push(
                typeof origin?.resource === "string"
                  ? origin.resource
                  : undefined,
              );
              dynamic ||= connection.dependency?.type === "import()";
            }
            optimizer.checkImporters(
              resource,
              importers,
              dynamic,
              compiler.context,
            );
          }
        }
        const error = optimizer.error();
        if (error) compilation.errors.push(new WebpackError(error));
      });
    });
  }
}
