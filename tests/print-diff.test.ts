import {
  formatDiff,
  logAssetDiff,
} from "carbon-preprocess-svelte/plugins/print-diff";

describe("print-diff", () => {
  test("formats one prefixed line", () => {
    expect(
      formatDiff({
        id: "id",
        originalCss: "body { color: red; } .bx--btn {}",
        optimizedCss: "body { color: red; }",
      }),
    ).toBe("carbon-preprocess-svelte: id 0.03 kB → 0.02 kB (-37.5%)");
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
    ).toBe("carbon-preprocess-svelte: large-file 2 MB → 1.5 MB (-25%)");
  });

  test("handles empty output", () => {
    expect(
      formatDiff({ id: "empty", originalCss: "body { }", optimizedCss: "" }),
    ).toBe("carbon-preprocess-svelte: empty 0.01 kB → 0 kB (-100%)");
  });

  test("measures a Uint8Array source as bytes, not as a joined array", () => {
    const original = "body { color: red; } .bx--btn {}";
    const optimizedCss = "body { color: red; }";
    const asBytes = formatDiff({
      id: "id",
      originalCss: new TextEncoder().encode(original),
      optimizedCss,
    });

    expect(asBytes).toContain("id 0.03 kB → 0.02 kB");
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

    test("writes the line to console.log by default", () => {
      const log = jest.spyOn(console, "log").mockImplementation(() => {});
      expect(logAssetDiff(props)).toBe(true);
      expect(log.mock.calls).toEqual([[formatDiff(props)]]);
      log.mockRestore();
    });

    test("appends a note", () => {
      const messages: string[] = [];
      logAssetDiff({
        ...props,
        note: "3 Carbon components rewritten",
        log: (m) => messages.push(m),
      });
      expect(messages).toEqual([
        "carbon-preprocess-svelte: id 0.03 kB → 0.02 kB (-37.5%), 3 Carbon components rewritten",
      ]);
    });

    test("marks a dry run, through `log` when given", () => {
      const messages: string[] = [];
      logAssetDiff({ ...props, dryRun: true, log: (m) => messages.push(m) });
      expect(messages).toEqual([
        "carbon-preprocess-svelte: dry run, left as is: id 0.03 kB → 0.02 kB (-37.5%)",
      ]);
    });

    test("logs nothing when the size is unchanged", () => {
      const messages: string[] = [];
      expect(
        logAssetDiff({
          id: "id",
          originalCss: "a",
          optimizedCss: "a",
          log: (m) => messages.push(m),
        }),
      ).toBe(false);
      expect(messages).toEqual([]);
    });
  });
});
