import assert from "assert";
import * as build from "../../src/build";

const result = build.type.serializeTypeStyles({
  fontSize: 4,
  breakpoints: { md: { fontSize: 2 } },
});

assert.strictEqual(result.css, "font-size: 4;");
assert.deepStrictEqual(result.breakpoints[0], {
  css: "font-size: 2",
  mediaQuery: "@media (min-width: 42rem)",
});
