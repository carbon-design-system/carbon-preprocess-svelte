import {
  canNameTokens,
  collectTokenNames,
  pruneUnusedTokens,
} from "../src/plugins/prune-tokens";

const ROOT = ":root{--cds-a:#000;--cds-b:var(--cds-a);--cds-c:#fff;--ccs-x:1}";

function prune(sheets: string[], literals: string[] = []) {
  return pruneUnusedTokens(sheets, literals);
}

describe("pruneUnusedTokens", () => {
  test("removes tokens nothing reads", () => {
    expect(prune([`${ROOT}.bx--btn{color:var(--cds-c)}`])).toEqual({
      css: [":root{--cds-c:#fff;--ccs-x:1}.bx--btn{color:var(--cds-c)}"],
      removed: [2],
      undeclared: [],
    });
  });

  test("keeps the tokens a read token's value reads", () => {
    expect(prune([`${ROOT}.bx--btn{color:var(--cds-b)}`]).css).toEqual([
      ":root{--cds-a:#000;--cds-b:var(--cds-a);--ccs-x:1}.bx--btn{color:var(--cds-b)}",
    ]);
  });

  test("keeps tokens read by other custom properties and at-rule params", () => {
    const css = `${ROOT}.bx--x{--ccs-y:var( --cds-a )}@container style(--v:var(--cds-c)){.bx--y{a:b}}`;
    expect(prune([css]).css[0]).toContain("--cds-a:#000;");
    expect(prune([css]).css[0]).toContain("--cds-c:#fff");
    expect(prune([css]).css[0]).not.toContain("--cds-b:");
  });

  test("reads across every sheet of the build", () => {
    const { css, removed } = prune([ROOT, ".app{color:var(--cds-a)}"]);
    expect(css[0]).toBe(":root{--cds-a:#000;--ccs-x:1}");
    expect(removed).toEqual([2, 0]);
  });

  test("keeps tokens named by literals, exactly or by prefix", () => {
    expect(prune([ROOT], ["--cds-c"]).css[0]).toBe(
      ":root{--cds-c:#fff;--ccs-x:1}",
    );
    expect(prune([ROOT], ["--cds-"]).css[0]).toBe(ROOT);
  });

  test("leaves every sheet unchanged when one can't be read", () => {
    const broken = ".app{color:var(--cds-a)";
    expect(prune([ROOT, broken])).toEqual({
      css: [ROOT, broken],
      removed: [0, 0],
      undeclared: [],
    });
  });

  test("leaves sheets without tokens alone", () => {
    expect(prune([".bx--btn{a:b}"])).toEqual({
      css: [".bx--btn{a:b}"],
      removed: [0],
      undeclared: [],
    });
  });

  test("lists tokens read with no fallback that nothing declares", () => {
    const css = `${ROOT}.app{background:var(--cds-ui-01);color:var( --cds-text-01 )}.x{a:var(--cds-a)}`;
    expect(prune([css]).undeclared).toEqual(["--cds-text-01", "--cds-ui-01"]);
  });

  test("lists them across sheets, and from a read token's value", () => {
    const sheets = [ROOT, ":root{--cds-d:var(--cds-gone)}.app{a:var(--cds-d)}"];
    expect(prune(sheets).undeclared).toEqual(["--cds-gone"]);
  });

  test("skips reads with a fallback, and ones only an unread token makes", () => {
    const css = `${ROOT}:root{--cds-d:var(--cds-gone)}.app{a:var(--cds-x, #000);b:var(--cds-y,var(--cds-a))}`;
    expect(prune([css]).undeclared).toEqual([]);
  });

  test("skips names that scripts or markup name, exactly or by prefix", () => {
    const css = `${ROOT}.app{a:var(--cds-x);b:var(--cds-button-y)}`;
    expect(prune([css], ["--cds-x", "--cds-button-"]).undeclared).toEqual([]);
  });

  test("lists nothing when no sheet declares a token", () => {
    expect(prune([".app{a:var(--cds-layer-01)}"]).undeclared).toEqual([]);
  });
});

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
