import { MappingsBuilder } from "../preprocessors/mappings-builder";

/**
 * Text built from slices of a source and inserted strings that remembers
 * where each slice came from, so a rewrite can hand the bundler a source
 * map without a dependency.
 */

/**
 * `[outStart, sourceStart, length]`: `length` characters of the text at
 * `outStart` were copied from `sourceStart`. Runs are in order in both.
 */
type Run = readonly [number, number, number];

export type MappedText = { text: string; runs: Run[] };

export type SourceMap = {
  version: 3;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
};

/** `source.slice(start, end)`, mapped. */
export function sliceOf(
  source: string,
  start: number,
  end: number,
): MappedText {
  return {
    text: source.slice(start, end),
    runs: end > start ? [[0, start, end - start]] : [],
  };
}

export function concat(...parts: Array<MappedText | string>): MappedText {
  let text = "";
  const runs: Run[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      text += part;
      continue;
    }
    for (const [out, from, length] of part.runs) {
      runs.push([out + text.length, from, length]);
    }
    text += part.text;
  }
  return { text, runs };
}

export type Splice = { start: number; end: number; text?: string };

/**
 * Replaces ranges of `input.text` (sorted, not overlapping). Runs keep the
 * parts outside the ranges; inserted text isn't mapped.
 */
export function splice(
  input: MappedText,
  edits: readonly Splice[],
): MappedText {
  if (edits.length === 0) return input;
  let text = "";
  let cursor = 0;
  /** Output offset of each kept input range: `[inStart, inEnd, outStart]`. */
  const kept: Array<[number, number, number]> = [];
  for (const edit of edits) {
    kept.push([cursor, edit.start, text.length]);
    text += input.text.slice(cursor, edit.start) + (edit.text ?? "");
    cursor = edit.end;
  }
  kept.push([cursor, input.text.length, text.length]);
  text += input.text.slice(cursor);

  const runs: Run[] = [];
  for (const [out, from, length] of input.runs) {
    for (const [inStart, inEnd, outStart] of kept) {
      const start = Math.max(out, inStart);
      const end = Math.min(out + length, inEnd);
      if (start < end) {
        runs.push([
          outStart + start - inStart,
          from + start - out,
          end - start,
        ]);
      }
    }
  }
  return { text, runs };
}

/** Removes every match of the global `pattern` in `[from, to)` of the text. */
export function removeMatches(
  input: MappedText,
  pattern: RegExp,
  from = 0,
  to = input.text.length,
): MappedText {
  const edits: Splice[] = [];
  for (const match of input.text.slice(from, to).matchAll(pattern)) {
    const start = from + match.index;
    edits.push({ start, end: start + match[0].length });
  }
  return splice(input, edits);
}

/**
 * A v3 source map from `mapped` back to `source`. Copied text gets a
 * mapping at every word (like magic-string's `hires: "boundary"`), and
 * inserted text maps to the source it replaced.
 */
export function toSourceMap(
  mapped: MappedText,
  source: string,
  sourceName: string,
): SourceMap {
  const builder = new MappingsBuilder();
  const { text } = mapped;
  let out = 0;
  let from = 0;
  for (const [runOut, runFrom, length] of mapped.runs) {
    // Runs follow the source in order; one that doesn't is left unmapped.
    if (runFrom < from) continue;
    if (runOut > out) {
      builder.replace(text.slice(out, runOut), source, from, runFrom);
    } else if (runFrom > from) {
      builder.skip(source, from, runFrom);
    }
    builder.copy(text.slice(runOut, runOut + length));
    out = runOut + length;
    from = runFrom + length;
  }
  if (out < text.length) {
    builder.replace(text.slice(out), source, from, source.length);
  }
  return {
    version: 3,
    sources: [sourceName],
    sourcesContent: [source],
    names: [],
    mappings: builder.toString(),
  };
}
