import { printDiff } from "carbon-preprocess-svelte/plugins/print-diff";

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

  test("handles MB-scale files", () => {
    const log = jest.spyOn(console, "log");
    const largeString = "x".repeat(2_000_000); // ~2MB
    const smallerString = "x".repeat(1_500_000); // ~1.5MB

    printDiff({
      original_css: largeString,
      optimized_css: smallerString,
      id: "large-file",
    });

    expect(log.mock.calls).toEqual([
      ["\n"],
      ["Optimized", "large-file"],
      ["Before:", "  2 MB"],
      ["After: ", "1.5 MB", "(-25%)\n"],
    ]);
  });

  test("handles empty strings", () => {
    const log = jest.spyOn(console, "log");

    printDiff({
      original_css: "body { }",
      optimized_css: "",
      id: "empty",
    });

    expect(log.mock.calls).toEqual([
      ["\n"],
      ["Optimized", "empty"],
      ["Before:", "0.01 kB"],
      ["After: ", "   0 kB", "(-100%)\n"],
    ]);
  });

  test("handles Buffer input", () => {
    const log = jest.spyOn(console, "log");
    const buffer = Buffer.from("body { color: red; }");

    printDiff({
      original_css: buffer,
      optimized_css: "body{color:red}",
      id: "buffer-input",
    });

    expect(log.mock.calls).toEqual([
      ["\n"],
      ["Optimized", "buffer-input"],
      ["Before:", "0.02 kB"],
      ["After: ", "0.02 kB", "(-25%)\n"],
    ]);
  });

  test("handles Uint8Array input", () => {
    const log = jest.spyOn(console, "log");
    const uint8Array = new TextEncoder().encode("body { color: red; }");

    printDiff({
      original_css: uint8Array,
      optimized_css: "body{color:red}",
      id: "uint8array-input",
    });

    expect(log.mock.calls).toEqual([
      ["\n"],
      ["Optimized", "uint8array-input"],
      ["Before:", "0.07 kB"],
      ["After: ", "0.02 kB", "(-78.87%)\n"],
    ]);
  });
});
