import {
  canNameTokens,
  collectTokenNames,
  collectTokenReads,
  tokenNamesFile,
} from "../src/plugins/token-names";

describe("collectTokenNames", () => {
  test("collects literal names, including a bare prefix", () => {
    const names = new Set<string>();
    collectTokenNames(
      'el.style.setProperty("--cds-layer", v); `--cds-${t}`; --ccs-x',
      names,
    );
    expect([...names]).toEqual(["--cds-layer", "--cds-"]);
  });
});

describe("canNameTokens", () => {
  test.each([
    ["assets/index.js", true],
    ["chunk.mjs?v=1", true],
    ["index.html", true],
    ["logo.svg", true],
    ["styles.css", false],
    ["photo.png", false],
  ])("%s", (id, expected) => {
    expect(canNameTokens(id)).toBe(expected);
  });
});

describe("tokenNamesFile", () => {
  test("lists names, and turns a bare prefix into a template that builds them", () => {
    expect(tokenNamesFile(["--cds-a", "--cds-", "--cds-a"]).code).toBe(
      "--cds-a\n`--cds-${name}`",
    );
  });
});

describe("collectTokenReads", () => {
  test("collects what a stylesheet reads, not what it defines", () => {
    const into = new Set<string>();
    collectTokenReads(":root{--cds-a:1}.x{color:var(--cds-b)}", into);
    expect([...into]).toEqual(["--cds-b"]);
  });
});
