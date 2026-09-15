import { CarbonSvelte } from "../src/constants";
import {
  isCarbonSvelteImport,
  isCssFile,
  isScannableModule,
  isSvelteFile,
  stripQuery,
} from "../src/utils";

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

describe("stripQuery", () => {
  test("returns the id unchanged when there is no query or hash", () => {
    expect(stripQuery("App.svelte")).toBe("App.svelte");
  });

  test("strips a query string", () => {
    expect(stripQuery("App.svelte?a=b")).toBe("App.svelte");
  });

  test("strips a hash", () => {
    expect(stripQuery("App.svelte#hash")).toBe("App.svelte");
  });

  test("strips a query string followed by a hash", () => {
    expect(stripQuery("App.svelte?a=b#hash")).toBe("App.svelte");
  });
});

describe("isScannableModule", () => {
  test("returns false for virtual modules", () => {
    expect(isScannableModule("\0virtual:x")).toBe(false);
  });

  test("returns false for Svelte style sub-modules", () => {
    expect(
      isScannableModule("/app/App.svelte?svelte&type=style&lang.css"),
    ).toBe(false);
  });

  test("returns false for CSS files", () => {
    expect(isScannableModule("/app/styles.css")).toBe(false);
  });

  test("returns false for carbon-components-svelte sources", () => {
    expect(
      isScannableModule(
        `/n/node_modules/${CarbonSvelte.Components}/src/Button/Button.js`,
      ),
    ).toBe(false);
  });

  test("returns true for app sources", () => {
    expect(isScannableModule("/app/src/App.svelte")).toBe(true);
  });

  test("returns true for other node_modules packages", () => {
    expect(isScannableModule("/n/node_modules/some-lib/dist/index.js")).toBe(
      true,
    );
  });
});
