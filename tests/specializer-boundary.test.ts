import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { lexImportsExports } from "sveast/lexer";

// `src/specializer` is meant to be extracted as its own package: it must
// stay free of Carbon and of the rest of this package.
const DIR = path.join(import.meta.dir, "../src/specializer");
const files = readdirSync(DIR).filter((file) => file.endsWith(".ts"));

describe("src/specializer", () => {
  test.each(files)("%s imports only its own modules and packages", (file) => {
    const code = readFileSync(path.join(DIR, file), "utf8");
    const outside = lexImportsExports(code)
      .map((statement) => statement.source?.value)
      .filter((source) => source?.startsWith("../"));
    expect(outside).toEqual([]);
  });

  test.each(files)("%s doesn't name Carbon", (file) => {
    const code = readFileSync(path.join(DIR, file), "utf8");
    expect(code.match(/carbon|bx--/gi) ?? []).toEqual([]);
  });
});
