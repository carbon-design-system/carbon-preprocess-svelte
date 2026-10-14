import { statSync } from "node:fs";
import path from "node:path";
import {
  createExportResolver,
  type Export,
  type ExportResolver,
  readPackageExports,
} from "./exports";
import { installedMajor, requirePackageDir } from "./package";
import { isSvelteFile, stripQuery } from "./util";

/** How the analysis reads a library's class names: see `LibrarySpec.classTokens`. */
export type ClassTokens = {
  /** Text that may name a class contains it (`"x--"`). */
  marker: string;
  text(text: string): string[];
};

/** A Svelte component library the specializer reads and rewrites. */
export type LibrarySpec = {
  /** The package apps import: `"my-library"`. */
  name: string;
  /** The directory of its modules in the package: `"src"`. */
  srcDir: string;
  /** Its barrel, in `srcDir`: `"index.js"`. */
  barrel: string;
  /**
   * Packages whose exports are components (an icon set): an app that
   * passes one as a prop passes an object.
   */
  componentPackages: readonly string[];
  /**
   * What its context keys start with (`"my-library:"`): an app module that
   * holds such a string may set or read the library's contexts.
   */
  contextKeyPrefix: string;
  /** Names the library in messages: `"My Library"`. */
  label: string;
  /** Names the tool in messages, and starts each warning and error: `"my-plugin"`. */
  tool: string;
  /**
   * The CSS classes text names, for analyses that prune the library's
   * styles: `text` reads a string in a component (markup, a literal) that
   * contains `marker`, `script` a whole script module. Without them, no
   * classes are read.
   */
  classTokens?: ClassTokens & {
    script(code: string, into: Set<string>): void;
  };
};

/** One import of a library module, an edge of the bundler's module graph: `id` is the library module, `specifier` what `importer` wrote, when the bundler says. */
export type LibraryImport = {
  id: string;
  importer: string;
  specifier?: string;
};

const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\/]/g;

function escapeRegExp(text: string): string {
  return text.replace(REGEXP_SPECIAL, "\\$&");
}

/** `make(spec)`, made once per spec. */
function perSpec<T>(make: (spec: LibrarySpec) => T): (spec: LibrarySpec) => T {
  const cache = new WeakMap<LibrarySpec, T>();
  return (spec) => {
    let value = cache.get(spec);
    if (value === undefined) {
      value = make(spec);
      cache.set(spec, value);
    }
    return value;
  };
}

/** The regexes an app module's text is read with for `spec`'s library. */
export const libraryPatterns = perSpec(patternsOf);

function patternsOf(spec: LibrarySpec) {
  const name = escapeRegExp(spec.name);
  const component = `${name}\\/${escapeRegExp(spec.srcDir)}\\/`;
  return {
    /** A computed `import()` argument that starts with the package name. */
    argument: new RegExp(`\\s*["'\`]${name}\\b`, "y"),
    /** A direct path to a component: `pkg/src/Button/Button.svelte`. */
    directComponentPath: new RegExp(`^${component}(.+\\.svelte)$`),
    /** A string that's one of its context keys. */
    contextKey: new RegExp(
      `(["'\`])(${escapeRegExp(spec.contextKeyPrefix)}[^"'\`\\s]+)\\1`,
      "g",
    ),
    /** An import of one of its modules that isn't a component. */
    scriptSpecifier: new RegExp(
      `["']${component}(?![^"']*\\.svelte["'])[^"']*["']`,
    ),
    barrelImport: new RegExp(
      `\\bimport\\s+(type\\s+)?\\{([^}]*)\\}\\s*from\\s*(["'])${name}\\3`,
      "g",
    ),
    barrelSpecifier: new RegExp(`["']${name}["']`, "g"),
    directComponentSpecifier: new RegExp(
      `["']${component}([^"']+\\.svelte)["']`,
      "g",
    ),
    /** Imports that are components, so passing one as a prop passes an object. */
    componentSource: new RegExp(
      spec.componentPackages.length > 0
        ? `\\.svelte$|^(?:${spec.componentPackages.map(escapeRegExp).join("|")})(\\/|$)`
        : "\\.svelte$",
    ),
    /** An import or `require` of it in a file the lexer can't read. */
    importText: new RegExp(
      `\\b(?:from|import|require)\\s*\\(?\\s*["'\`]${name}(?:["'\`]|\\/)`,
    ),
    /** `import()` or `require()` of the barrel, a module's path, or a path computed from the name. */
    dynamicImport: new RegExp(
      `\\b(?:import|require)\\s*\\(\\s*(["'\`])(${name}(?:\\/[^"'\`]*)?)\\1`,
      "g",
    ),
    /** A direct path to a component, capturing its file name. */
    directComponentName: new RegExp(
      `^${component}.+\\/([A-Za-z0-9_]+)\\.svelte$`,
    ),
    /** The package as a whole path segment. */
    segment: new RegExp(`(^|[\\\\/])${name}([\\\\/]|$)`),
    /** A path in its `srcDir`, capturing the module key. */
    srcSegment: new RegExp(
      `(?:^|[\\\\/])${name}[\\\\/]${escapeRegExp(spec.srcDir)}[\\\\/](.+)$`,
    ),
  };
}

const BACKSLASH = /\\/g;

/** What a library's module paths and specifiers look like, from its spec alone. */
export class LibraryPaths {
  readonly spec: LibrarySpec;
  readonly patterns: ReturnType<typeof patternsOf>;

  constructor(spec: LibrarySpec) {
    this.spec = spec;
    this.patterns = libraryPatterns(spec);
  }

  get name(): string {
    return this.spec.name;
  }

  /** Starts every warning and error: `"my-plugin:"`. */
  get logPrefix(): string {
    return `${this.spec.tool}:`;
  }

  /** `pkg/src/`: what a direct path to one of its modules starts with. */
  get srcPrefix(): string {
    return `${this.name}/${this.spec.srcDir}/`;
  }

  /** The barrel, as `moduleKey` names it. */
  get barrelKey(): string {
    return this.spec.barrel;
  }

  /** `…/pkg/src/Button/Button.svelte` -> `Button/Button.svelte`. */
  moduleKey(id: string): string | undefined {
    return this.patterns.srcSegment.exec(id)?.[1].replace(BACKSLASH, "/");
  }

  /**
   * `moduleKey` of a component or the barrel: the modules whose imports
   * the analysis reads. `undefined` for any other module.
   */
  importKey(id: string): string | undefined {
    const key = this.moduleKey(stripQuery(id));
    return key && (key === this.barrelKey || isSvelteFile(key))
      ? key
      : undefined;
  }

  /**
   * Whether `specifier` names the package as the analysis reads it. Any
   * other import that resolves into it (a bundler alias) is one the
   * analysis can't see.
   */
  isSpecifier(specifier: string): boolean {
    return specifier === this.name || specifier.startsWith(`${this.name}/`);
  }

  /** Whether `id` is one of its `.svelte` modules. */
  isComponentFile(id: string): boolean {
    return isSvelteFile(id) && this.patterns.segment.test(id);
  }
}

/** `LibraryPaths` for `spec`, made once. */
export const libraryPaths = perSpec((spec) => new LibraryPaths(spec));

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
