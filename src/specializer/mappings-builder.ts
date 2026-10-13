const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const COMMA = 44;
const SEMICOLON = 59;
const BASE64_A = 65;

/** Base64 digit of a non-negative one-digit VLQ (`value < 16`). */
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
 * Output buffer shared across builders: `transformScript` is synchronous and
 * never nested. It grows to the largest mapping built, but a buffer past
 * `SCRATCH_RETAIN_LIMIT` isn't kept, so one huge file doesn't pin memory.
 */
const SCRATCH_INITIAL = 4096;
const SCRATCH_RETAIN_LIMIT = 1 << 20;
let scratch = new Uint8Array(SCRATCH_INITIAL);

/**
 * Builds a v3 source map's `mappings` as the transformed code is emitted,
 * tracking the original cursor as text is copied or replaced.
 *
 * Resolution matches magic-string's `hires: "boundary"`: untouched text gets
 * a segment at the start of every word and at each non-word character; each
 * line of replacement text maps back to the start of the statement it
 * replaced.
 *
 * `mappings` is pure ASCII, so it is written byte by byte into a growable
 * buffer and decoded once: appending a string per segment is dominated by
 * rope building.
 */
export class MappingsBuilder {
  private buffer = scratch;
  private length = 0;
  // Original cursor.
  private line = 0;
  private column = 0;
  // Generated cursor.
  private genColumn = 0;
  private lineHasSegments = false;
  // Previous segment fields; mappings are delta-encoded.
  private prevGenColumn = 0;
  private prevLine = 0;
  private prevColumn = 0;

  /** Copies `text` from the original to the output unchanged. */
  copy(text: string): void {
    const length = text.length;
    if (length === 0) return;

    // Worst case is a segment per character: `,` + digit + `AA` + digit.
    // Longer segments (delta 16+) only follow 16+ characters that wrote none.
    this.reserve(length * 5 + 64);
    const buffer = this.buffer;
    let out = this.length;

    // Columns advance in lockstep while copying: the generated one is
    // `column + offset` until a newline resets both.
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
          // After the first segment on a line: `,<vlq(d)>AA<vlq(d)>`.
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

  /** Emits `content` in place of `original[start, end)`. */
  replace(content: string, original: string, start: number, end: number): void {
    this.addSegment();

    let lineStart = 0;
    let newline = content.indexOf("\n");
    while (newline !== -1) {
      lineStart = newline + 1;
      // Each further line maps to the same original position (all deltas
      // zero); a trailing newline leaves an empty last line with no segment.
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

  /** Advances the original cursor past `original[start, end)` (removed text). */
  skip(original: string, start: number, end: number): void {
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

  /** Maps the generated cursor to the original cursor. */
  private addSegment(): void {
    const { genColumn, line, column } = this;
    // Three VLQs of at most 6 digits, plus separators.
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

/** Writes the base64 VLQ of `value` at `out`; returns the next offset. */
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
