import { realpathSync } from "node:fs";
import { RE_EXT_STYLESHEET, RE_STYLE_QUERY } from "../constants";
import type { ComponentIndex } from "../indexer/build-index";
import { resolveCarbonRoot } from "../indexer/resolve-carbon-root";
import { stripQuery } from "../utils";

/**
 * What scanned code passes to the props named by the index's variants
 * (`kind`, `tooltipPosition`, …), for narrowing `` `bx--btn--${kind}` ``
 * to the kinds an app actually renders.
 */
export type PropUsage = {
  /** Literal string values each prop is given somewhere. */
  literals: Map<string, Set<string>>;
  /**
   * Props given anything else somewhere: a variable, an expression, a
   * shorthand, a string key the scan can't follow. Every variant stays.
   */
  dynamic: Set<string>;
};

export function createPropUsage(): PropUsage {
  return { literals: new Map(), dynamic: new Set() };
}

/** Adds everything `from` recorded to `into`. */
export function mergePropUsage(into: PropUsage, from: PropUsage): void {
  for (const prop of from.dynamic) into.dynamic.add(prop);
  for (const [prop, values] of from.literals) {
    const merged = into.literals.get(prop) ?? new Set<string>();
    for (const value of values) merged.add(value);
    into.literals.set(prop, merged);
  }
}

/**
 * Marks every variant prop in the index dynamic: for code that can't be
 * scanned, which could pass any of them anything.
 */
export function markAllDynamic(
  usage: PropUsage,
  components: ComponentIndex,
): void {
  for (const prop of variantProps(components)) usage.dynamic.add(prop);
  usage.literals.clear();
}

/**
 * Prop names the index's variants and gates depend on: what the scan
 * looks for.
 */
export function variantProps(components: ComponentIndex): Set<string> {
  const props = new Set<string>();
  for (const entry of Object.values(components)) {
    for (const variant of entry.variants ?? []) {
      props.add(variant.prop);
    }
    for (const gate of entry.gates ?? []) {
      for (const and of gate.when) {
        for (const condition of and) props.add(condition.prop);
      }
    }
  }
  return props;
}

const QUOTES = "\"'`";

const DOLLAR = /\$/g;

/** Characters that continue an expression past a literal: `"a" + b`. */
const CONTINUATION = "+-*%?.[(|&=<^!~:\"'`";

const IDENTIFIER_CHAR = /[\w$]/;

/** A value that reads as one class suffix. */
const CLASS_SUFFIX = /^[\w-]+$/;

function isSpace(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

function skipSpace(source: string, index: number): number {
  let i = index;
  while (isSpace(source[i]) || source[i] === "\n" || source[i] === "\r") i++;
  return i;
}

/**
 * The string literal at `index`, and where it ends, or `undefined` for
 * anything but a plain quoted string: escapes, template substitutions and
 * line breaks all read as dynamic.
 */
function readString(
  source: string,
  index: number,
): { value: string; end: number } | undefined {
  const quote = source[index];
  if (!QUOTES.includes(quote)) return undefined;

  const close = source.indexOf(quote, index + 1);
  if (close === -1) return undefined;

  const value = source.slice(index + 1, close);
  if (
    value.includes("\\") ||
    value.includes("\n") ||
    (quote === "`" && value.includes("${"))
  ) {
    return undefined;
  }

  return { value, end: close + 1 };
}

/**
 * `true` or `false` at `index`, as the strings `"true"`/`"false"`: how a
 * boolean prop arrives (`<Tag filter>` compiles to `filter: true`).
 */
function readBoolean(
  source: string,
  index: number,
): { value: string; end: number } | undefined {
  for (const value of ["true", "false"]) {
    const end = index + value.length;
    if (
      source.startsWith(value, index) &&
      !IDENTIFIER_CHAR.test(source[end] ?? "")
    ) {
      return { value, end };
    }
  }
  return undefined;
}

/**
 * The literal value assigned at `index` (just past `=` or `:`): `"ghost"`,
 * `{"ghost"}` (a Svelte attribute), or `undefined` when the value is
 * anything else or continues past the literal (`"a" + b`, `"a" ? …`).
 */
function readLiteralValue(source: string, index: number): string | undefined {
  let i = skipSpace(source, index);
  const braced = source[i] === "{";
  if (braced) i = skipSpace(source, i + 1);

  const literal = readString(source, i) ?? readBoolean(source, i);
  if (!literal) return undefined;

  i = literal.end;
  while (isSpace(source[i])) i++;

  if (braced) {
    if (source[i] !== "}") return undefined;
    i++;
    while (isSpace(source[i])) i++;
  }

  const next = source[i];
  if (next !== undefined && CONTINUATION.includes(next)) return undefined;
  if (next === "/" && source[i + 1] !== ">") return undefined;

  return CLASS_SUFFIX.test(literal.value) ? literal.value : undefined;
}

/** Index of the last non-whitespace character before `index`. */
function previousNonSpace(source: string, index: number): number {
  let i = index - 1;
  while (
    i >= 0 &&
    (isSpace(source[i]) || source[i] === "\n" || source[i] === "\r")
  ) {
    i--;
  }
  return i;
}

/** Whether `index` starts `=` as assignment, not `==`, `===` or `=>`. */
function isAssignment(source: string, index: number): boolean {
  return (
    source[index] === "=" &&
    source[index + 1] !== "=" &&
    source[index + 1] !== ">"
  );
}

/**
 * Scans module code for every place it names one of `props`, and records
 * the literal each is given. Written against what reaches the bundler
 * plugins: compiled Svelte (`kind: "ghost"`), plain JS objects and
 * assignments, JSON modules, and the markup Svelte 4 leaves in dev
 * comments (`kind="ghost"`, `kind={"ghost"}`).
 *
 * A prop passed anything it can't read as a literal is marked dynamic, so
 * a miss keeps every variant rather than dropping one. That covers
 * assignments and keys with any other value (`kind: k`), object shorthand
 * (`{ kind }`), getters (`get kind()`, how Svelte 5 passes reactive
 * props) and string keys (`$.prop($$props, "kind")`). Other mentions
 * can't pass a prop and are skipped: member reads (`node.kind`), and the
 * word in prose (`// some kind of`, `"a kind of"`).
 *
 * Returns `undefined` when there are no props to look for.
 */
export function createPropScanner(
  props: Iterable<string>,
): ((source: string, into: PropUsage) => void) | undefined {
  const names = [...props];
  if (names.length === 0) return undefined;

  const pattern = new RegExp(
    `(?<![\\w$])(?:${names.map((name) => name.replace(DOLLAR, "\\$")).join("|")})(?![\\w$])`,
    "g",
  );

  return (source, into) => {
    for (const match of source.matchAll(pattern)) {
      const name = match[0];
      if (into.dynamic.has(name)) continue;

      const start = match.index;
      const before = source[start - 1];
      let i = start + name.length;
      let value: string | undefined;

      if (before !== undefined && QUOTES.includes(before)) {
        // A quoted name passes a prop only as a key: `{ "kind": "ghost" }`
        // in a JSON module, or a computed `["kind"]: …` / `["kind"] = …`.
        // Anything else is a string value (`kind: "danger"` names Modal's
        // `danger` prop only as text) or a read (`$.prop($$props, "kind")`).
        if (source[start - 2] === "\\") {
          // `\"kind\":` is a key inside a string, as in the
          // `JSON.parse("{\"kind\":…}")` Vite emits for large JSON modules;
          // its value can't be read reliably.
          if (source[i] === "\\" && source[i + 2] === ":") {
            into.dynamic.add(name);
            into.literals.delete(name);
          }
          continue;
        }
        if (source[i] !== before) continue;
        i = skipSpace(source, i + 1);
        const computed = source[i] === "]";
        if (computed) i = skipSpace(source, i + 1);
        if (source[i] === ":" || (computed && isAssignment(source, i))) {
          value = readLiteralValue(source, i + 1);
        } else {
          continue;
        }
      } else if (before === ".") {
        // `node.kind` reads; only `props.kind = "ghost"` could pass it.
        while (isSpace(source[i])) i++;
        if (!isAssignment(source, i)) continue;
        value = readLiteralValue(source, i + 1);
      } else {
        while (isSpace(source[i])) i++;
        if (
          isAssignment(source, i) ||
          (source[i] === ":" && source[i + 1] !== ":")
        ) {
          value = readLiteralValue(source, i + 1);
        } else if (
          source[i] !== "(" &&
          !(
            (source[i] === "," || source[i] === "}") &&
            "{,".includes(source[previousNonSpace(source, start)])
          )
        ) {
          continue;
        }
      }

      if (value === undefined) {
        into.dynamic.add(name);
        into.literals.delete(name);
        continue;
      }

      const values = into.literals.get(name) ?? new Set<string>();
      values.add(value);
      into.literals.set(name, values);
    }
  };
}

const BACKSLASH = /\\/g;

/**
 * Framework runtimes in every bundle. They forward props but never
 * originate a value for a Carbon component, and they name `type`, `size`,
 * `open`, `disabled`, … in their own code, which would mark those props
 * dynamic in every app.
 */
const FRAMEWORK_RUNTIME =
  /\/node_modules\/(?:svelte|@sveltejs\/kit|astro|devalue|vite)\//;

function toPosix(file: string): string {
  return file.replace(BACKSLASH, "/");
}

/**
 * `<carbon>/src/` as bundlers name its modules (symlinks resolved, forward
 * slashes), for telling Carbon's own sources apart from app code, or
 * `undefined` when Carbon can't be resolved.
 */
export function carbonSourceDir(projectRoot: string): string | undefined {
  try {
    return `${toPosix(realpathSync(resolveCarbonRoot(projectRoot)))}/src/`;
  } catch {
    return undefined;
  }
}

/**
 * Reads one module's prop usage, or `undefined` when there is nothing to
 * record for it.
 */
export type ModulePropScanner = (
  id: string,
  code: string,
) => PropUsage | undefined;

/**
 * Wraps `createPropScanner` with which modules to read, failing open:
 *
 * - Every module is read except stylesheets, Carbon's own `src/`
 *   (`carbonSrc`), whose components read their own props (`let kind =
 *   $.prop($$props, "kind")`) and would mark every prop dynamic, and the
 *   framework runtimes in `FRAMEWORK_RUNTIME`. Unlike the
 *   `bx--` token scan, a path merely containing `carbon-components-svelte`
 *   (a fork, Carbon's docs site) or a virtual module is still read: a
 *   module skipped here could pass a literal nothing records, and its
 *   variant would be dropped.
 * - Without `carbonSrc`, Carbon's modules are read too, which keeps every
 *   variant rather than guessing.
 * - A scan that throws marks every prop dynamic instead of failing the
 *   build.
 *
 * Returns `undefined` when the index names no variant props.
 */
export function createModulePropScanner(
  components: ComponentIndex,
  carbonSrc: string | undefined,
): ModulePropScanner | undefined {
  const props = variantProps(components);
  const scan = createPropScanner(props);
  if (!scan) return undefined;

  return (id, code) => {
    const file = toPosix(stripQuery(id));
    if (
      RE_EXT_STYLESHEET.test(file) ||
      RE_STYLE_QUERY.test(id) ||
      (carbonSrc !== undefined && file.startsWith(carbonSrc)) ||
      FRAMEWORK_RUNTIME.test(file)
    ) {
      return undefined;
    }

    const usage = createPropUsage();
    try {
      scan(code, usage);
    } catch {
      markAllDynamic(usage, components);
    }

    return usage.dynamic.size > 0 || usage.literals.size > 0
      ? usage
      : undefined;
  };
}
