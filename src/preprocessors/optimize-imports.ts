import type { SveltePreprocessor } from "svelte/types/compiler/preprocess";
import { getComponents, setComponents } from "../component-index-registry";
import { CarbonSvelte } from "../constants";
import { ensureLiveComponentIndex } from "../indexer/live-index";

const NODE_MODULES_REGEX = /node_modules/;

// Import specifiers can't contain a semicolon, so bounding the clause with
// `[^;]` keeps the lazy match from ever crossing into a later statement,
// without needing a stateful parser to find each declaration's extent.
const IMPORT_DECLARATION_REGEX =
  /^([ \t]*)import\s+(type\s+)?(?:([^;]*?)\s+from\s+)?["']([^"']+)["']\s*;?/gm;
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

function encodeVlq(value: number): string {
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
  let encoded = "";
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) digit |= 32;
    encoded += BASE64_CHARS[digit];
  } while (vlq > 0);
  return encoded;
}

// Inside an untouched run of text, generated and original columns advance in
// lockstep, so every segment after the first on a line is a delta `d` on both:
// `,<vlq(d)>A A <vlq(d)>` (source index 0, same source line). Precomputing
// those for realistic word/punctuation gaps turns the hot path into one
// string append.
const SAME_LINE_SEGMENTS = Array.from(
  { length: 128 },
  (_, delta) => `,${encodeVlq(delta)}AA${encodeVlq(delta)}`,
);

function isWordChar(code: number): boolean {
  return (
    (code >= 97 && code <= 122) || // a-z
    (code >= 65 && code <= 90) || // A-Z
    (code >= 48 && code <= 57) || // 0-9
    code === 95 // _
  );
}

/**
 * Builds a v3 source map while the transformed code is emitted, tracking the
 * original cursor as text is copied or replaced so no separate locator pass
 * over the input is needed.
 *
 * Mapping resolution matches magic-string's `hires: "boundary"`: untouched
 * text gets a segment at the start of every word and at each non-word
 * character; each line of replacement text maps back to the start of the
 * statement it replaced.
 */
class MappingsBuilder {
  private mappings = "";
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

    let inWord = false;
    let sameLine = false;
    let mappings = this.mappings;
    let { column, genColumn } = this;

    for (let i = 0; i < length; i++) {
      const code = text.charCodeAt(i);

      if (code === 10) {
        mappings += ";";
        this.line++;
        column = 0;
        genColumn = 0;
        this.prevGenColumn = 0;
        this.lineHasSegments = false;
        inWord = false;
        sameLine = false;
        continue;
      }

      const word = isWordChar(code);
      if (!word || !inWord) {
        if (sameLine) {
          const delta = column - this.prevColumn;
          mappings +=
            delta < 128
              ? SAME_LINE_SEGMENTS[delta]
              : `,${encodeVlq(delta)}AA${encodeVlq(delta)}`;
          this.prevGenColumn = genColumn;
          this.prevColumn = column;
        } else {
          this.mappings = mappings;
          this.column = column;
          this.genColumn = genColumn;
          this.addSegment();
          mappings = this.mappings;
          sameLine = true;
        }
      }
      inWord = word;

      column++;
      genColumn++;
    }

    this.mappings = mappings;
    this.column = column;
    this.genColumn = genColumn;
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
      this.mappings += lineStart < content.length ? ";AAAA" : ";";
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
    this.mappings +=
      (this.lineHasSegments ? "," : "") +
      encodeVlq(genColumn - this.prevGenColumn) +
      "A" +
      encodeVlq(line - this.prevLine) +
      encodeVlq(column - this.prevColumn);
    this.lineHasSegments = true;
    this.prevGenColumn = genColumn;
    this.prevLine = line;
    this.prevColumn = column;
  }

  toString(): string {
    return this.mappings;
  }
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
export type OptimizeImportsOptions = {
  experimental?: {
    /**
     * Build the component index from *this project's* installed
     * `carbon-components-svelte` instead of using the version bundled with
     * `carbon-preprocess-svelte`. Resolved once per build (cached on disk,
     * keyed by the installed Carbon version) and falls back to the bundled
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

  IMPORT_DECLARATION_REGEX.lastIndex = 0;
  let match = IMPORT_DECLARATION_REGEX.exec(raw);
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

    match = IMPORT_DECLARATION_REGEX.exec(raw);
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
