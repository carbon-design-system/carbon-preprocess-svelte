import { CarbonSvelte } from "../src/constants.ts";
import { isCarbonSvelteImport, isCssFile, isSvelteFile } from "../src/utils.ts";

describe("isSvelteFile", () => {
  test("returns true for .svelte files", () => {
    expect(isSvelteFile("Component.svelte")).toBe(true);
    expect(isSvelteFile("path/to/Component.svelte")).toBe(true);
    expect(isSvelteFile("./Component.svelte")).toBe(true);
  });

  test("returns false for non-svelte files", () => {
    expect(isSvelteFile("Component.js")).toBe(false);
    expect(isSvelteFile("Component.css")).toBe(false);
    expect(isSvelteFile("Component")).toBe(false);
    expect(isSvelteFile("Component.svelte.js")).toBe(false);
  });
});

describe("isCssFile", () => {
  test("returns true for .css files", () => {
    expect(isCssFile("styles.css")).toBe(true);
    expect(isCssFile("path/to/styles.css")).toBe(true);
    expect(isCssFile("./styles.css")).toBe(true);
  });

  test("returns false for non-css files", () => {
    expect(isCssFile("styles.scss")).toBe(false);
    expect(isCssFile("styles.less")).toBe(false);
    expect(isCssFile("styles")).toBe(false);
    expect(isCssFile("styles.css.js")).toBe(false);
  });
});

describe("isCarbonSvelteImport", () => {
  test("returns true for Carbon Svelte component imports", () => {
    expect(
      isCarbonSvelteImport(
        `node_modules/${CarbonSvelte.Components}/Button.svelte`,
      ),
    ).toBe(true);
    expect(
      isCarbonSvelteImport(`${CarbonSvelte.Components}/Button.svelte`),
    ).toBe(true);
  });

  test("returns false for non-Carbon Svelte imports", () => {
    expect(isCarbonSvelteImport("Button.svelte")).toBe(false);
    expect(isCarbonSvelteImport(`${CarbonSvelte.Icons}/Button.svelte`)).toBe(
      false,
    );
    expect(isCarbonSvelteImport(`${CarbonSvelte.Components}/Button.js`)).toBe(
      false,
    );
    expect(isCarbonSvelteImport("other-lib/Button.svelte")).toBe(false);
  });
});
