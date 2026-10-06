import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createComponentOptimizer,
  type OptimizeComponentsOptions,
} from "./component-optimizer";
import { optimizerRegistry } from "./optimizer-registry";

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
  dependency?: { type?: string } | null;
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

type WebpackCompiler = {
  options: { mode?: string; module: { rules: unknown[] } };
  context: string;
  webpack: { WebpackError: new (message: string) => Error };
  hooks: {
    beforeRun: AsyncHook;
    watchRun: AsyncHook;
    thisCompilation: {
      tap(
        name: string,
        callback: (compilation: WebpackCompilation) => void,
      ): void;
    };
  };
  getInfrastructureLogger(name: string): { info(message: string): void };
};

const NAME = "OptimizeComponentsPlugin";
const CARBON_SVELTE_FILE = /[\\/]carbon-components-svelte[\\/].+\.svelte$/;

/** The loader's built file next to the bundle, or its source in a checkout. */
const LOADER = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "optimize-components-loader.js"),
    path.join(here, "..", "optimize-components-loader.ts"),
  ];
  return candidates.find((file) => existsSync(file)) ?? candidates[0];
})();

let nextId = 0;

/**
 * `optimizeComponents` for webpack and Rspack: rewrites
 * each Carbon component the app renders for the props it passes. Pair it
 * with `new OptimizeCssPlugin({ propAware: true })`.
 *
 * Runs on production builds only. It adds a loader that runs before
 * `svelte-loader` on Carbon's `.svelte` files, and fails the build if a
 * module outside `content` imports a Carbon component.
 */
export class OptimizeComponentsPlugin {
  private options: OptimizeComponentsOptions;

  public constructor(options?: OptimizeComponentsOptions) {
    this.options = { ...options };
  }

  public apply(compiler: WebpackCompiler) {
    if (compiler.options.mode !== "production") return;

    const { WebpackError } = compiler.webpack;
    const optimizer = createComponentOptimizer(this.options, NAME);
    const id = String(nextId++);
    optimizerRegistry().set(id, optimizer);

    compiler.options.module.rules.push({
      test: CARBON_SVELTE_FILE,
      enforce: "pre",
      use: [{ loader: LOADER, options: { id } }],
    });

    let warning: string | undefined;
    const prepare = async () => {
      const result = await optimizer.prepare(compiler.context);
      warning = result.warning;
      if (result.info) compiler.getInfrastructureLogger(NAME).info(result.info);
      for (const line of result.report ?? []) console.log(line);
    };
    compiler.hooks.beforeRun.tapPromise(NAME, prepare);
    compiler.hooks.watchRun.tapPromise(NAME, prepare);

    compiler.hooks.thisCompilation.tap(NAME, (compilation) => {
      if (warning) compilation.warnings.push(new WebpackError(warning));
      compilation.hooks.finishModules.tap(NAME, (modules) => {
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
