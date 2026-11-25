import {
  canNameTokens,
  collectTokenNames,
  collectTokenReads,
  tokenNamesFile,
} from "../src/plugins/token-names";

describe("collectTokenNames", () => {
  test("collects literal names, including a bare prefix", () => {
    const names = new Set<string>();
    collectTokenNames('get("--cds-layer"); `--cds-${t}`; --ccs-x', names);
    expect([...names]).toEqual(["--cds-layer", "--cds-"]);
  });

  test("sets aside names a script only sets or removes", () => {
    const collect = (source: string) => {
      const names = new Set<string>();
      const written = new Set<string>();
      collectTokenNames(source, names, written);
      return { names: [...names], written: [...written] };
    };
    // Carbon's `Theme`, as written and as a minifier leaves it.
    expect(
      collect(
        "s.setProperty(`--cds-${token}`, value); s.removeProperty(`--cds-${token}`)",
      ),
    ).toEqual({ names: [], written: ["--cds-"] });
    expect(collect('e.style.setProperty("--cds-"+t,n)')).toEqual({
      names: [],
      written: ["--cds-"],
    });
    expect(collect("el.style.setProperty('--cds-layer', v)")).toEqual({
      names: [],
      written: ["--cds-layer"],
    });
    // A value that reads a token still names it.
    expect(
      collect('el.style.setProperty("color", "var(--cds-text-primary)")'),
    ).toEqual({ names: ["--cds-text-primary"], written: [] });
    // So does a read of the same name elsewhere.
    expect(
      collect(
        'el.style.setProperty("--cds-layer", v); getPropertyValue("--cds-layer")',
      ),
    ).toEqual({ names: ["--cds-layer"], written: ["--cds-layer"] });
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
