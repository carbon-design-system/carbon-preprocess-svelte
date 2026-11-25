import { findUndeclaredTokens } from "../src/plugins/undeclared-tokens";

const ROOT = ":root{--cds-a:1}";

describe("findUndeclaredTokens", () => {
  test("lists tokens read without a fallback that no sheet declares", () => {
    expect(
      findUndeclaredTokens(
        [`${ROOT}.app{color:var(--cds-ui-01);background:var(--cds-a)}`],
        [],
      ),
    ).toEqual(["--cds-ui-01"]);
  });

  test("leaves out reads with a fallback, but not a fallback's own bare read", () => {
    expect(
      findUndeclaredTokens([`${ROOT}.app{color:var(--cds-x, #fff)}`], []),
    ).toEqual([]);
    expect(
      findUndeclaredTokens(
        [`${ROOT}.app{color:var(--cds-x,var(--cds-y))}`],
        [],
      ),
    ).toEqual(["--cds-y"]);
  });

  test("leaves out tokens another sheet declares, or that scripts or markup name", () => {
    const reads = ".app{color:var(--cds-z)}";
    expect(findUndeclaredTokens([reads, ":root{--cds-z:1}"], [])).toEqual([]);
    expect(findUndeclaredTokens([reads, ROOT], ["--cds-z"])).toEqual([]);
    expect(findUndeclaredTokens([reads, ROOT], ["--cds-"])).toEqual([]);
    expect(findUndeclaredTokens([reads, ROOT], ["--cds-z-"])).toEqual([
      "--cds-z",
    ]);
  });

  test("finds none when no sheet declares a token: the themes load elsewhere", () => {
    expect(findUndeclaredTokens([".app{color:var(--cds-z)}"], [])).toEqual([]);
  });

  test("follows read tokens' values, and only theirs", () => {
    const css = ":root{--cds-b:var(--cds-missing);--cds-c:var(--cds-gone)}";
    expect(
      findUndeclaredTokens([`${css}.app{color:var(--cds-b)}`], []),
    ).toEqual(["--cds-missing"]);
  });

  test.each(["all", "white", "g100"])(
    "finds none in Carbon's own %s.css",
    async (theme) => {
      const css = await Bun.file(
        require.resolve(`carbon-components-svelte/css/${theme}.css`),
      ).text();
      expect(findUndeclaredTokens([css], [])).toEqual([]);
    },
  );
});
