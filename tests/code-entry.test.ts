import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  ansiToHtml,
  carbonCodeIcon,
  decodeTokens,
  encodeTokens,
  prepareFence,
  renderCodeLines,
  tokenName,
} from "carbon-preprocess-svelte/code";

const SRC = resolve(import.meta.dirname, "../src");
const IMPORT = /^\s*(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']/gm;

/** Every module `src/code.ts` reaches, and the external specifiers they import. */
function graph(entry: string) {
  const seen = new Set<string>();
  const externals = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(IMPORT)) {
      if (specifier.startsWith("."))
        visit(`${join(dirname(file), specifier)}.ts`);
      else externals.add(specifier);
    }
  };
  visit(entry);
  return {
    files: [...seen].map((f) => f.slice(SRC.length + 1)),
    externals: [...externals],
  };
}

describe("carbon-preprocess-svelte/code", () => {
  test("reaches no Node built-in, so it's safe to ship to the browser", () => {
    const { files, externals } = graph(join(SRC, "code.ts"));
    expect(externals).toEqual([]);
    expect(files.some((f) => f.includes("preprocessors"))).toBe(false);
  });

  test("exports the code-view helpers", () => {
    const helpers = [
      prepareFence,
      encodeTokens,
      decodeTokens,
      tokenName,
      ansiToHtml,
      carbonCodeIcon,
      renderCodeLines,
    ];
    expect(helpers.every((helper) => typeof helper === "function")).toBe(true);
    expect(tokenName("controlKeyword")).toBe("control-keyword");
  });
});
