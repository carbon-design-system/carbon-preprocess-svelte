import { describe, expect, spyOn, test } from "bun:test";
import { compareDiff } from "../src/plugins/compare-diff";

describe("compare-diff", () => {
  test("output", () => {
    const log = spyOn(console, "log");

    expect(
      compareDiff({
        original_css: "body { color: red; } .bx--btn {}",
        optimized_css: "body { color: red; }",
        id: "id",
      })
    );
    expect(log.mock.calls).toEqual([
      ["\n"],
      ["Optimized", "id"],
      ["Before:", "0.03 kB"],
      ["After: ", "0.02 kB", "(-37.5%)\n"],
    ]);
  });
});
