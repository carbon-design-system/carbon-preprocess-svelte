import {
  formatDiff,
  logAssetDiff,
} from "carbon-preprocess-svelte/plugins/print-diff";

describe("print-diff", () => {
  test("formats the size block", () => {
    expect(
      formatDiff({
        id: "id",
        originalCss: "body { color: red; } .bx--btn {}",
        optimizedCss: "body { color: red; }",
      }),
    ).toBe("\n\nOptimized id\nBefore: 0.03 kB\nAfter:  0.02 kB (-37.5%)\n");
  });

  test("returns null when nothing changed", () => {
    expect(
      formatDiff({
        id: "id",
        originalCss: "body { color: red; }",
        optimizedCss: "body { color: red; }",
      }),
    ).toBeNull();
  });

  test("handles MB-scale files", () => {
    expect(
      formatDiff({
        id: "large-file",
        originalCss: "x".repeat(2_000_000),
        optimizedCss: "x".repeat(1_500_000),
      }),
    ).toBe("\n\nOptimized large-file\nBefore:   2 MB\nAfter:  1.5 MB (-25%)\n");
  });

  test("handles empty output", () => {
    expect(
      formatDiff({ id: "empty", originalCss: "body { }", optimizedCss: "" }),
    ).toBe("\n\nOptimized empty\nBefore: 0.01 kB\nAfter:     0 kB (-100%)\n");
  });

  test("measures a Uint8Array source as bytes, not as a joined array", () => {
    const original = "body { color: red; } .bx--btn {}";
    const optimizedCss = "body { color: red; }";
    const asBytes = formatDiff({
      id: "id",
      originalCss: new TextEncoder().encode(original),
      optimizedCss,
    });

    expect(asBytes).toContain("Before: 0.03 kB");
    expect(asBytes).toEqual(
      formatDiff({ id: "id", originalCss: original, optimizedCss }),
    );
  });

  describe("logAssetDiff", () => {
    const props = {
      id: "id",
      originalCss: "body { color: red; } .bx--btn {}",
      optimizedCss: "body { color: red; }",
    };

    test("writes the block to console.log by default", () => {
      const log = jest.spyOn(console, "log").mockImplementation(() => {});
      logAssetDiff(props);
      expect(log.mock.calls).toEqual([[formatDiff(props)]]);
      log.mockRestore();
    });

    test("writes the dry-run notice first, through `log` when given", () => {
      const messages: string[] = [];
      logAssetDiff({ ...props, dryRun: true, log: (m) => messages.push(m) });
      expect(messages).toEqual([
        "Dry run: id left unchanged",
        formatDiff(props),
      ]);
    });

    test("logs nothing when the size is unchanged", () => {
      const messages: string[] = [];
      logAssetDiff({
        id: "id",
        originalCss: "a",
        optimizedCss: "a",
        log: (m) => messages.push(m),
      });
      expect(messages).toEqual([]);
    });
  });
});
