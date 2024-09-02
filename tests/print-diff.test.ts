import { printDiff } from "@/plugins/print-diff";

describe("print-diff", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("output", () => {
    const log = jest.spyOn(console, "log");

    expect(
      printDiff({
        original_css: "body { color: red; } .bx--btn {}",
        optimized_css: "body { color: red; }",
        id: "id",
      }),
    );
    expect(log.mock.calls).toEqual([
      ["\n"],
      ["Optimized", "id"],
      ["Before:", "0.03 kB"],
      ["After: ", "0.02 kB", "(-37.5%)\n"],
    ]);
  });

  test("no diff", () => {
    const log = jest.spyOn(console, "log");

    expect(
      printDiff({
        original_css: "body { color: red; }",
        optimized_css: "body { color: red; }",
        id: "id",
      }),
    );

    expect(log.mock.calls).toEqual([]);
  });
});
