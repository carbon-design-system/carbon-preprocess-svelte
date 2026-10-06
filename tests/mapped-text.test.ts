import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFiles } from "../src/analyzer";
import {
  concat,
  type MappedText,
  removeMatches,
  sliceOf,
  splice,
  toSourceMap,
} from "../src/analyzer/mapped-text";
import { specializeComponent } from "../src/analyzer/specialize";

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** `[line, column, sourceLine, sourceColumn]` for each segment. */
function decode(mappings: string): number[][] {
  const segments: number[][] = [];
  let sourceLine = 0;
  let sourceColumn = 0;
  for (const [line, text] of mappings.split(";").entries()) {
    let column = 0;
    for (const segment of text.split(",")) {
      if (segment === "") continue;
      const values: number[] = [];
      let value = 0;
      let shift = 0;
      for (const char of segment) {
        const digit = BASE64.indexOf(char);
        value += (digit & 31) << shift;
        if (digit & 32) {
          shift += 5;
        } else {
          values.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          shift = 0;
        }
      }
      column += values[0];
      sourceLine += values[2];
      sourceColumn += values[3];
      segments.push([line, column, sourceLine, sourceColumn]);
    }
  }
  return segments;
}

function offsetOf(text: string, line: number, column: number): number {
  let offset = 0;
  for (let i = 0; i < line; i++) offset = text.indexOf("\n", offset) + 1;
  return offset + column;
}

/** Every copied run still holds the source text it claims to. */
function expectRunsHold(mapped: MappedText, source: string): void {
  for (const [out, from, length] of mapped.runs) {
    expect(mapped.text.slice(out, out + length)).toBe(
      source.slice(from, from + length),
    );
  }
}

describe("MappedText", () => {
  const source = "let a = kind;\nlet b = size;\n";

  test("concat, splice and removeMatches keep copied runs in place", () => {
    const folded = concat(
      sliceOf(source, 0, 8),
      '"ghost"',
      sliceOf(source, 12, source.length),
    );
    expect(folded.text).toBe('let a = "ghost";\nlet b = size;\n');
    expectRunsHold(folded, source);

    const spliced = splice(folded, [
      { start: 0, end: 0, text: "// note\n" },
      { start: 17, end: 31 },
    ]);
    expect(spliced.text).toBe('// note\nlet a = "ghost";\n');
    expectRunsHold(spliced, source);

    const trimmed = removeMatches(spliced, /\s+$/g);
    expect(trimmed.text).toBe('// note\nlet a = "ghost";');
    expectRunsHold(trimmed, source);
  });

  test("the source map points copied tokens at their source", () => {
    const mapped = concat(
      sliceOf(source, 0, 8),
      '"ghost"',
      sliceOf(source, 12, source.length),
    );
    const map = toSourceMap(mapped, source, "X.svelte");
    expect(map.sources).toEqual(["X.svelte"]);
    expect(map.sourcesContent).toEqual([source]);
    // `let a = "ghost";` / `let b = size;`: `"ghost"` maps to `kind`.
    expect(decode(map.mappings)).toContainEqual([0, 8, 0, 8]);
    expect(decode(map.mappings)).toContainEqual([1, 8, 1, 8]);
  });
});

test("a specialized Carbon component maps back to its source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mapped-text-"));
  try {
    const file = join(dir, "App.svelte");
    const code = `<script>import { Button } from "carbon-components-svelte";</script>\n<Button kind="tertiary" size="small">Hi</Button>`;
    writeFileSync(file, code);
    const result = await analyzeFiles({
      projectRoot: process.cwd(),
      files: [{ file, code }],
      components: ["Button"],
      options: {},
    });
    if ("warning" in result) throw new Error(result.warning);
    const scope = result.analysis.scopeFor("Button/Button.svelte");
    if (!scope) throw new Error("Button isn't live");
    const source = scope.model.code;
    const { code: output, mapped } = specializeComponent(scope, {
      unwrap: true,
    });
    expect(mapped.text).toBe(output);
    expectRunsHold(mapped, source);

    const copied = (out: number) =>
      mapped.runs.some(
        ([start, , length]) => out >= start && out < start + length,
      );
    const segments = decode(
      toSourceMap(mapped, source, "Button.svelte").mappings,
    );
    expect(segments.length).toBeGreaterThan(100);
    for (const [line, column, sourceLine, sourceColumn] of segments) {
      const out = offsetOf(output, line, column);
      // Inserted text maps to the source it replaced.
      if (!copied(out)) continue;
      expect(output[out]).toBe(
        source[offsetOf(source, sourceLine, sourceColumn)],
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
