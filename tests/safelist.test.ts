import { isSafelisted } from "../src/plugins/safelist";

const BTN_VARIANT = /^\.bx--btn--/;
const BTN_GLOBAL = /^\.bx--btn/g;

describe("isSafelisted", () => {
  test("string entries match a complete class token", () => {
    expect(isSafelisted(".bx--grid:hover", [".bx--grid"])).toBe(true);
    expect(isSafelisted(".bx--grid-narrow", [".bx--grid"])).toBe(false);
  });

  test("RegExp entries test the whole selector", () => {
    expect(isSafelisted(".bx--btn--primary", [BTN_VARIANT])).toBe(true);
    expect(isSafelisted(".bx--tabs", [BTN_VARIANT])).toBe(false);
  });

  test("a global RegExp gives the same answer on every call", () => {
    const safelist = [BTN_GLOBAL];
    expect(isSafelisted(".bx--btn", safelist)).toBe(true);
    expect(isSafelisted(".bx--btn", safelist)).toBe(true);
  });
});
