import { statSync } from "node:fs";
import path from "node:path";
import {
  createExportResolver,
  type Export,
  type ExportResolver,
} from "./exports";
import { LibraryPaths, type LibrarySpec, libraryPaths } from "./library-paths";
import { installedMajor, requirePackageDir } from "./package";
import { readPackageExports } from "./package-exports";

/** A library as installed: its root and exported components. */
export class Library extends LibraryPaths {
  /** The installed package's directory. */
  readonly root: string;
  /** Export name -> module key in `srcDir` (`Button` -> `Button/Button.svelte`). */
  readonly components: Map<string, string>;

  constructor(
    spec: LibrarySpec,
    root: string,
    components: Map<string, string>,
  ) {
    super(spec);
    this.root = root;
    this.components = components;
  }

  /** The directory of its modules. */
  get src(): string {
    return path.join(this.root, this.spec.srcDir);
  }

  private exports?: ExportResolver;

  /** What its barrel exports as `name`: see `Export`. */
  exportOf(name: string): Export {
    this.exports ??= createExportResolver(this.src);
    return this.exports.exportOf(this.spec.barrel, name);
  }

  private svelte?: { major: number | undefined };

  /**
   * Major version of the Svelte it compiles with, as resolved from its
   * root; `undefined` when none resolves. Svelte 5 passes a component's
   * content as its `children` prop.
   */
  get svelteMajor(): number | undefined {
    this.svelte ??= { major: installedMajor("svelte", this.root) };
    return this.svelte.major;
  }
}

const componentsCache = new Map<
  string,
  { mtimeMs: number; components: Map<string, string> }
>();

/**
 * `spec`'s library installed at `root`. Its components are cached by the
 * modification time of its barrel, so a linked checkout edited between
 * `vite build --watch` rebuilds is read again.
 */
export function libraryAt(spec: LibrarySpec, root: string): Library {
  const barrel = path.join(root, spec.srcDir, spec.barrel);
  const { mtimeMs } = statSync(barrel);
  const cacheKey = `${spec.name}\0${root}`;
  let cached = componentsCache.get(cacheKey);
  if (cached?.mtimeMs !== mtimeMs) {
    const components = new Map<string, string>();
    const prefix = libraryPaths(spec).srcPrefix;
    for (const [name, target] of readPackageExports(root, spec)) {
      if (target.name === "default" && target.path.endsWith(".svelte")) {
        components.set(name, target.path.slice(prefix.length));
      }
    }
    cached = { mtimeMs, components };
    componentsCache.set(cacheKey, cached);
  }
  return new Library(spec, root, new Map(cached.components));
}

/** `spec`'s library as the project at `projectRoot` installs it. */
export function loadLibrary(spec: LibrarySpec, projectRoot: string): Library {
  return libraryAt(spec, requirePackageDir(spec.name, projectRoot));
}
