import path from "node:path";
import { type LexedImport, lexImportsExports } from "sveast/lexer";
import type { SveltePreprocessor } from "svelte/types/compiler/preprocess";
import { CarbonSvelte } from "../constants";
import { resolveCarbonRoot } from "../indexer/resolve-carbon-root";
import {
  type CarbonExport,
  isIdentifierName,
  readCarbonExports,
} from "./carbon-exports";

const LOG_PREFIX = "[carbon-preprocess-svelte]";

const NODE_MODULES_REGEX = /node_modules/;

const BARRELS = new Set<string>([
  CarbonSvelte.Components,
  CarbonSvelte.Icons,
  CarbonSvelte.Pictograms,
]);

/**
 * Carbon's barrel exports, read on first use: files that only import icons
 * or pictograms never need `carbon-components-svelte` installed.
 */
export type CarbonExportsLoader = () => ReadonlyMap<string, CarbonExport>;

/** Emits `import local from "path"` or `import { name as local } from "path"`. */
function directImport(local: string, path: string, name: string): string {
  if (name === "default") return `import ${local} from "${path}";`;
  const binding = name === local ? name : `${name} as ${local}`;
  return `import { ${binding} } from "${path}";`;
}

/** `name`, or `"name"` for an arbitrary-string module export name. */
function exportName(name: string): string {
  return isIdentifierName(name) ? name : JSON.stringify(name);
}

/**
 * Builds the direct-path replacement for one barrel import statement, or
 * returns `null` when nothing in it should change. Type-only specifiers,
 * default and namespace imports, and names the installed Carbon's barrel
 * doesn't export stay on the barrel.
 */
function rewriteImport(
  statement: LexedImport,
  loadExports: CarbonExportsLoader,
): string | null {
  const source = statement.source?.value;
  if (source === undefined || statement.typeOnly || !BARRELS.has(source)) {
    return null;
  }

  let rewritten = "";
  const kept: string[] = [];
  const keptNamed: string[] = [];

  for (const specifier of statement.specifiers) {
    const local = specifier.local;

    if (specifier.kind !== "named") {
      kept.push(specifier.kind === "default" ? local : `* as ${local}`);
      continue;
    }

    const imported = exportName(specifier.imported);
    const isType = specifier.typeOnly;
    let replacement: string | undefined;
    if (!isType && isIdentifierName(specifier.imported)) {
      if (source !== CarbonSvelte.Components) {
        replacement = `import ${local} from "${source}/lib/${imported}.svelte";`;
      } else {
        const target = loadExports().get(imported);
        if (target) replacement = directImport(local, target.path, target.name);
      }
    }

    if (replacement === undefined) {
      const binding = imported === local ? local : `${imported} as ${local}`;
      keptNamed.push(isType ? `type ${binding}` : binding);
    } else {
      if (rewritten) rewritten += "\n";
      rewritten += replacement;
    }
  }

  if (!rewritten) return null;

  // Mixed imports: put preserved names back on the barrel next to rewritten paths.
  if (keptNamed.length > 0) kept.push(`{ ${keptNamed.join(", ")} }`);
  if (kept.length > 0) {
    rewritten += `\nimport ${kept.join(", ")} from "${source}";`;
  }

  return rewritten;
}

const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const COMMA = 44;
const SEMICOLON = 59;
const BASE64_A = 65;

/** Base64 digit of a one-digit VLQ (`value < 16`, non-negative). */
const VLQ_DIGIT = new Uint8Array(16);
for (let value = 0; value < 16; value++) {
  VLQ_DIGIT[value] = BASE64_CHARS.charCodeAt(value << 1);
}

/** `[A-Za-z0-9_]`, indexed by char code. */
const WORD_CHAR = new Uint8Array(128);
for (let code = 0; code < 128; code++) {
  WORD_CHAR[code] =
    (code >= 97 && code <= 122) || // a-z
    (code >= 65 && code <= 90) || // A-Z
    (code >= 48 && code <= 57) || // 0-9
    code === 95 // _
      ? 1
      : 0;
}

const ascii = new TextDecoder("latin1");

/**
 * Shared output buffer. `transformScript` is synchronous and never nested,
 * so one buffer serves every call; it grows to the largest mapping built so
 * far and is dropped back to its initial size past `SCRATCH_RETAIN_LIMIT`
 * so one huge file doesn't pin memory for the rest of the build.
 */
const SCRATCH_INITIAL = 4096;
const SCRATCH_RETAIN_LIMIT = 1 << 20;
let scratch = new Uint8Array(SCRATCH_INITIAL);

/**
 * Builds a v3 source map while the transformed code is emitted, tracking the
 * original cursor as text is copied or replaced so no separate locator pass
 * over the input is needed.
 *
 * Mapping resolution matches magic-string's `hires: "boundary"`: untouched
 * text gets a segment at the start of every word and at each non-word
 * character; each line of replacement text maps back to the start of the
 * statement it replaced.
 *
 * `mappings` is pure ASCII, so it is written a byte at a time into a
 * growable buffer and decoded once at the end. Untouched text produces a
 * segment every few characters, and appending each as a string spends most
 * of the time building rope strings.
 */
class MappingsBuilder {
  private buffer = scratch;
  private length = 0;
  // Original cursor (position in the input the next copy/replace consumes).
  private line = 0;
  private column = 0;
  // Generated cursor.
  private genColumn = 0;
  private lineHasSegments = false;
  // Previous segment fields (source map v3 mappings are delta-encoded).
  private prevGenColumn = 0;
  private prevLine = 0;
  private prevColumn = 0;

  /** Copies `text` from the original to the output unchanged. */
  copy(text: string): void {
    const length = text.length;
    if (length === 0) return;

    // Worst case is a segment per character: `,` + digit + `AA` + digit.
    // Longer segments (a delta of 16+) only follow a word of 16+ characters
    // that wrote nothing, so they stay under that bound too.
    this.reserve(length * 5 + 64);
    const buffer = this.buffer;
    let out = this.length;

    // Generated and original columns advance in lockstep while copying, so
    // only the original column is tracked; the generated one is `column +
    // offset` until a newline resets both.
    let column = this.column;
    let offset = this.genColumn - column;
    let prevColumn = this.prevColumn;
    let inWord = false;
    let sameLine = false;

    for (let i = 0; i < length; i++) {
      const code = text.charCodeAt(i);

      if (code === 10) {
        buffer[out++] = SEMICOLON;
        this.line++;
        column = 0;
        offset = 0;
        this.prevGenColumn = 0;
        this.lineHasSegments = false;
        inWord = false;
        sameLine = false;
        continue;
      }

      const word = code < 128 && WORD_CHAR[code] === 1;
      if (!word || !inWord) {
        if (sameLine) {
          // Every segment after the first on a line is a delta `d` on both
          // columns: `,<vlq(d)>AA<vlq(d)>` (source index 0, same line).
          const delta = column - prevColumn;
          buffer[out++] = COMMA;
          if (delta < 16) {
            const digit = VLQ_DIGIT[delta];
            buffer[out++] = digit;
            buffer[out++] = BASE64_A;
            buffer[out++] = BASE64_A;
            buffer[out++] = digit;
          } else {
            out = writeVlq(buffer, out, delta);
            buffer[out++] = BASE64_A;
            buffer[out++] = BASE64_A;
            out = writeVlq(buffer, out, delta);
          }
          prevColumn = column;
        } else {
          this.length = out;
          this.column = column;
          this.genColumn = column + offset;
          this.prevColumn = prevColumn;
          this.addSegment();
          out = this.length;
          prevColumn = column;
          sameLine = true;
        }
      }
      inWord = word;
      column++;
    }

    this.length = out;
    this.column = column;
    this.genColumn = column + offset;
    this.prevColumn = prevColumn;
    if (sameLine) this.prevGenColumn = prevColumn + offset;
  }

  /**
   * Emits `content` in place of `original[start, end)`, mapping every line of
   * it back to the replaced text's start.
   */
  replace(content: string, original: string, start: number, end: number): void {
    this.addSegment();

    let lineStart = 0;
    let newline = content.indexOf("\n");
    while (newline !== -1) {
      lineStart = newline + 1;
      // Each further line starts at generated column 0 and maps to the same
      // original position, so all four deltas are zero. A trailing newline
      // leaves an empty last line with no segment.
      this.reserve(5);
      const buffer = this.buffer;
      buffer[this.length++] = SEMICOLON;
      if (lineStart < content.length) {
        buffer[this.length++] = BASE64_A;
        buffer[this.length++] = BASE64_A;
        buffer[this.length++] = BASE64_A;
        buffer[this.length++] = BASE64_A;
      }
      newline = content.indexOf("\n", lineStart);
    }

    if (lineStart === 0) {
      this.genColumn += content.length;
    } else {
      this.genColumn = content.length - lineStart;
      this.prevGenColumn = 0;
      this.lineHasSegments = lineStart < content.length;
    }

    this.skip(original, start, end);
  }

  /** Advances the original cursor past `original[start, end)`. */
  private skip(original: string, start: number, end: number): void {
    let lastNewline = -1;
    let newline = original.indexOf("\n", start);
    while (newline !== -1 && newline < end) {
      this.line++;
      lastNewline = newline;
      newline = original.indexOf("\n", newline + 1);
    }
    this.column =
      lastNewline === -1 ? this.column + (end - start) : end - lastNewline - 1;
  }

  /** Adds a segment mapping the generated cursor to the original cursor. */
  private addSegment(): void {
    const { genColumn, line, column } = this;
    // Up to three VLQs of at most 6 digits, plus separators.
    this.reserve(25);
    const buffer = this.buffer;
    let out = this.length;
    if (this.lineHasSegments) buffer[out++] = COMMA;
    out = writeVlq(buffer, out, genColumn - this.prevGenColumn);
    buffer[out++] = BASE64_A;
    out = writeVlq(buffer, out, line - this.prevLine);
    out = writeVlq(buffer, out, column - this.prevColumn);
    this.length = out;
    this.lineHasSegments = true;
    this.prevGenColumn = genColumn;
    this.prevLine = line;
    this.prevColumn = column;
  }

  private reserve(bytes: number): void {
    const needed = this.length + bytes;
    if (needed <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < needed) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
    if (size <= SCRATCH_RETAIN_LIMIT) scratch = next;
  }

  toString(): string {
    return ascii.decode(this.buffer.subarray(0, this.length));
  }
}

/** Writes the base64 VLQ of `value` at `out`; returns the new offset. */
function writeVlq(buffer: Uint8Array, out: number, value: number): number {
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) digit |= 32;
    buffer[out++] = BASE64_CHARS.charCodeAt(digit);
  } while (vlq > 0);
  return out;
}

export function transformScript(
  raw: string,
  filename: string,
  loadExports: CarbonExportsLoader,
) {
  let code = "";
  let mappings: MappingsBuilder | undefined;
  let lastIndex = 0;

  for (const node of lexImportsExports(raw)) {
    if (node.kind !== "import") continue;
    const replacement = rewriteImport(node, loadExports);
    if (replacement === null) continue;

    const unchanged = raw.slice(lastIndex, node.start);
    mappings ??= new MappingsBuilder();
    mappings.copy(unchanged);
    mappings.replace(replacement, raw, node.start, node.end);

    code += unchanged + replacement;
    lastIndex = node.end;
  }

  // Nothing rewritten: hand the content back as-is. Svelte treats a missing
  // map as an identity map, so no need to build one.
  if (mappings === undefined) return { code: raw };

  const tail = raw.slice(lastIndex);
  mappings.copy(tail);
  code += tail;

  // Svelte only offsets a preprocessor's map to the `<script>` tag's position
  // when `sources` names the file exactly as Svelte does: by basename.
  const basename = filename.slice(
    Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\")) + 1,
  );

  return {
    code,
    map: {
      version: 3,
      sources: [basename],
      names: [],
      mappings: mappings.toString(),
    },
  };
}

/**
 * Barrel exports of the Carbon a directory resolves, as the bundler resolves
 * the barrel import. Cached per directory and per install; warns once.
 */
function createCarbonExportsResolver(): (
  dir: string,
) => ReadonlyMap<string, CarbonExport> {
  const byDir = new Map<string, ReadonlyMap<string, CarbonExport>>();
  const byCarbonRoot = new Map<string, ReadonlyMap<string, CarbonExport>>();
  let warned = false;

  return (dir) => {
    let exports = byDir.get(dir);
    if (exports) return exports;

    try {
      const carbonRoot = resolveCarbonRoot(dir);
      exports = byCarbonRoot.get(carbonRoot);
      if (!exports) {
        exports = readCarbonExports(carbonRoot);
        byCarbonRoot.set(carbonRoot, exports);
      }
    } catch (error) {
      if (!warned) {
        warned = true;
        console.warn(
          `${LOG_PREFIX} optimizeImports: could not read the exports of the installed ${CarbonSvelte.Components} (${(error as Error)?.message ?? error}); leaving its imports on the barrel.`,
        );
      }
      exports = new Map();
    }

    byDir.set(dir, exports);
    return exports;
  };
}

/**
 * Svelte preprocessor that transforms barrel imports from Carbon libraries
 * into direct path imports for better tree-shaking and faster builds.
 *
 * @example
 * ```ts
 *   import { Button, Modal } from "carbon-components-svelte";
 *   import { Add } from "carbon-icons-svelte";
 *   import { Airplane } from "carbon-pictograms-svelte";
 * ```
 * becomes:
 * ```ts
 *   import Button from "carbon-components-svelte/src/Button/Button.svelte";
 *   import Modal from "carbon-components-svelte/src/Modal/Modal.svelte";
 *   import Add from "carbon-icons-svelte/lib/Add.svelte";
 *   import Airplane from "carbon-pictograms-svelte/lib/Airplane.svelte";
 * ```
 *
 * Component paths come from the `src/index.js` of the
 * `carbon-components-svelte` each file resolves, so they match the installed
 * version. Names that barrel doesn't export stay on the barrel.
 */
export const optimizeImports: SveltePreprocessor<"script"> = () => {
  const carbonExportsFor = createCarbonExportsResolver();

  return {
    name: "carbon:optimize-imports",
    script({ filename, content: raw }) {
      // Skip files in node_modules to minimize unnecessary preprocessing
      if (!filename) return;
      if (NODE_MODULES_REGEX.test(filename)) return;

      // Fast path: the only rewritable import sources contain "carbon-".
      // Skip import scanning for the common no-Carbon file.
      if (!raw.includes("carbon-")) return;

      const dir = path.dirname(path.resolve(filename));
      return transformScript(raw, filename, () => carbonExportsFor(dir));
    },
  };
};
