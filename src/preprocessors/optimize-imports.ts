import type { SveltePreprocessor } from "svelte/types/compiler/preprocess";
import { getComponents, setComponents } from "../component-index-registry";
import { CarbonSvelte } from "../constants";
import { ensureLiveComponentIndex } from "../indexer/live-index";

const NODE_MODULES_REGEX = /node_modules/;

// Import specifiers can't contain a semicolon, so bounding the clause with
// `[^;]` keeps the lazy match from ever crossing into a later statement,
// without needing a stateful parser to find each declaration's extent.
//
// Sticky rather than global: `nextImportDeclaration` jumps to each `import`
// occurrence with `indexOf` and matches at that line's start only, instead of
// letting the regex crawl the whole script body after the last import.
const IMPORT_DECLARATION_REGEX =
  /^([ \t]*)import\s+(type\s+)?(?:([^;]*?)\s+from\s+)?["']([^"']+)["']\s*;?/my;

/** Where multiline `^` matches: after `\n`, `\r`, U+2028, U+2029. */
function isLineTerminator(code: number): boolean {
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}

/**
 * The next import declaration starting at or after `from`, in the same
 * order a global `^[ \t]*import…` regex would find them: an `import` keyword
 * preceded only by spaces/tabs since its line start.
 */
function nextImportDeclaration(
  raw: string,
  from: number,
): RegExpExecArray | null {
  let index = raw.indexOf("import", from);

  while (index !== -1) {
    let lineStart = index;
    while (lineStart > from) {
      const code = raw.charCodeAt(lineStart - 1);
      if (code !== 32 && code !== 9) break;
      lineStart--;
    }

    if (lineStart === 0 || isLineTerminator(raw.charCodeAt(lineStart - 1))) {
      IMPORT_DECLARATION_REGEX.lastIndex = lineStart;
      const match = IMPORT_DECLARATION_REGEX.exec(raw);
      if (match !== null) return match;
    }

    index = raw.indexOf("import", index + 6);
  }

  return null;
}
const TYPE_SPECIFIER_PREFIX_REGEX = /^type\s+/;
const AS_ALIAS_REGEX = /\s+as\s+/;
const WHITESPACE_REGEX = /\s/;

function isWhitespace(code: number): boolean {
  // ASCII controls/space cover real-world source; anything non-ASCII defers
  // to the regex so exotic Unicode spaces still trim like `String#trim`.
  return (
    code <= 32 ||
    (code > 127 && WHITESPACE_REGEX.test(String.fromCharCode(code)))
  );
}

type ComponentIndex = ReturnType<typeof getComponents>;

/**
 * Resolves the direct-path replacement for a named specifier, or `undefined`
 * when it should stay on the barrel.
 *
 * Names missing from the component index: PascalCase gets an optimistic
 * `src/Name/Name.svelte` path; camelCase stays on the barrel so utilities
 * don't point at a `.svelte` file that isn't there.
 */
function resolvePath(
  source: string,
  imported: string,
  components: ComponentIndex,
): string | undefined {
  if (source !== CarbonSvelte.Components) {
    return `${source}/lib/${imported}.svelte`;
  }

  // Prefer indexed path (handles .js and other special cases).
  const path = components[imported]?.path;
  if (path !== undefined) return path;

  // Not in index: PascalCase gets an optimistic component path;
  // camelCase stays on the barrel (utility, not a .svelte file).
  const code = imported.charCodeAt(0);
  if (code >= 65 && code <= 90) {
    return `${source}/src/${imported}/${imported}.svelte`;
  }

  return undefined;
}

/**
 * Builds the direct-path replacement for one barrel import statement, or
 * returns `null` when nothing in it should change.
 *
 * `optimizeImports` only ever rewrites named specifiers from three known
 * barrel sources, so this only scans the `{ ... }` clause. Default/namespace
 * specifiers are never rewritten, so they're intentionally left alone.
 */
function rewriteImport(
  source: string,
  clause: string | undefined,
  components: ComponentIndex,
): string | null {
  if (
    source !== CarbonSvelte.Components &&
    source !== CarbonSvelte.Icons &&
    source !== CarbonSvelte.Pictograms
  ) {
    return null;
  }
  if (!clause) return null;

  const open = clause.indexOf("{");
  if (open === -1) return null;
  const close = clause.indexOf("}", open + 1);
  if (close === -1) return null;

  let rewritten = "";
  let preserved = "";

  // Walk the comma-separated entries in place: one slice per name instead
  // of split + trim allocations for every specifier.
  let index = open + 1;
  while (index < close) {
    while (index < close && isWhitespace(clause.charCodeAt(index))) index++;
    if (index >= close) break;

    let entryEnd = clause.indexOf(",", index);
    if (entryEnd === -1 || entryEnd > close) entryEnd = close;
    let end = entryEnd;
    while (end > index && isWhitespace(clause.charCodeAt(end - 1))) end--;

    let imported: string;
    let local: string;
    let isType = false;

    // Bare `Name` (the overwhelmingly common case) has no inner whitespace;
    // only `type Name` and `Name as Alias` do.
    let space = index;
    while (space < end && !isWhitespace(clause.charCodeAt(space))) space++;
    if (space === end) {
      imported = local = clause.slice(index, end);
    } else {
      let entry = clause.slice(index, end);
      isType = TYPE_SPECIFIER_PREFIX_REGEX.test(entry);
      if (isType) entry = entry.replace(TYPE_SPECIFIER_PREFIX_REGEX, "");
      const [importedPart, localPart] = entry.split(AS_ALIAS_REGEX);
      imported = importedPart.trim();
      local = (localPart ?? importedPart).trim();
    }

    // Per-specifier type imports (`import { type X, Y }`) stay on the barrel.
    const path = isType ? undefined : resolvePath(source, imported, components);

    if (path === undefined) {
      // Keep specifier for barrel re-import below.
      if (preserved) preserved += ", ";
      if (isType) preserved += "type ";
      preserved += imported === local ? local : `${imported} as ${local}`;
    } else {
      if (rewritten) rewritten += "\n";
      rewritten += `import ${local} from "${path}";`;
    }

    index = entryEnd + 1;
  }

  if (!rewritten) return null;

  // Mixed imports: put preserved names back on the barrel next to rewritten paths.
  if (preserved) {
    rewritten += `\nimport { ${preserved} } from "${source}";`;
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

/**
 * Svelte preprocessor that transforms barrel imports from Carbon libraries
 * into direct path imports for better tree-shaking and faster builds.
 *
 * Skips loading the full component index, which speeds up HMR and builds.
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
 * Names missing from the component index: PascalCase gets an optimistic
 * `src/Name/Name.svelte` path; camelCase stays on the barrel so utilities
 * don't point at a `.svelte` file that isn't there.
 */
type OptimizeImportsOptions = {
  experimental?: {
    /**
     * Build the component index from *this project's* installed
     * `carbon-components-svelte` instead of using the version bundled with
     * `carbon-preprocess-svelte`. Resolved once per build (cached on disk,
     * keyed by the Carbon and preprocessor versions) and falls back to the bundled
     * index if anything about the live build fails.
     * @default false
     */
    liveIndex?: boolean;
  };
};

function transformScript(raw: string, filename: string) {
  const components = getComponents();
  let code = "";
  let mappings: MappingsBuilder | undefined;
  let lastIndex = 0;

  let match = nextImportDeclaration(raw, 0);
  while (match !== null) {
    const index = match.index;
    // `match[2]` is the `type` keyword: type-only statements
    // (`import type { ... }`) never reference a real `.svelte` file, so
    // leave them entirely untouched.
    const replacement = match[2]
      ? null
      : rewriteImport(match[4], match[3], components);

    if (replacement !== null) {
      const start = index + match[1].length;
      const end = index + match[0].length;
      const unchanged = raw.slice(lastIndex, start);

      mappings ??= new MappingsBuilder();
      mappings.copy(unchanged);
      mappings.replace(replacement, raw, start, end);

      code += unchanged + replacement;
      lastIndex = end;
    }

    match = nextImportDeclaration(raw, index + match[0].length);
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

export const optimizeImports: SveltePreprocessor<"script"> = (
  options?: OptimizeImportsOptions,
) => {
  let liveIndexReady: Promise<void> | undefined;

  return {
    name: "carbon:optimize-imports",
    // Not declared `async`: without `experimental.liveIndex`, this returns
    // the transformed result synchronously (existing callers rely on that).
    // Svelte's own preprocess pipeline accepts either a plain result or a
    // Promise, so the `liveIndex` branch returning a Promise below is
    // equally valid.
    script({ filename, content: raw }) {
      // Skip files in node_modules to minimize unnecessary preprocessing
      if (!filename) return;
      if (NODE_MODULES_REGEX.test(filename)) return;

      // Fast path: the only rewritable import sources contain "carbon-".
      // Skip import scanning for the common no-Carbon file.
      if (!raw.includes("carbon-")) return;

      if (options?.experimental?.liveIndex) {
        liveIndexReady ??= ensureLiveComponentIndex().then(setComponents);
        return liveIndexReady.then(() => transformScript(raw, filename));
      }

      return transformScript(raw, filename);
    },
  };
};
