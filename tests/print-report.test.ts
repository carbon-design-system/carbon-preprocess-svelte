import { printReport } from "carbon-preprocess-svelte/plugins/print-report";

describe("print-report", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("output", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    printReport({
      components: ["Button", "DataTable", "Modal"],
      allowlistSize: 431,
      moduleTokens: 21,
      contentTokens: 0,
      safelistEntries: 2,
      assets: [
        {
          id: "assets/index-CU4gbKFa.css",
          removed: 1204,
          beforeBytes: 606_260,
          afterBytes: 53_220,
        },
        {
          id: "assets/route-Bx91.css",
          removed: 0,
          beforeBytes: 12_400,
          afterBytes: 12_400,
        },
      ],
    });

    expect(log.mock.calls).toEqual([
      [""],
      ["carbon-preprocess-svelte report"],
      ["  Detected components (3): Button, DataTable, Modal"],
      [
        "  Allowlist: 431 classes (module scan 21 tokens, content 0 tokens, safelist 2 entries)",
      ],
      ["  Assets:"],
      [
        "    assets/index-CU4gbKFa.css   1,204 rules removed   606.26 kB -> 53.22 kB",
      ],
      ["    assets/route-Bx91.css       nothing to prune      12.40 kB"],
    ]);
  });

  test("no detected components", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    printReport({
      components: [],
      allowlistSize: 0,
      moduleTokens: 0,
      contentTokens: 0,
      safelistEntries: 0,
      assets: [],
    });

    expect(log.mock.calls).toEqual([
      [""],
      ["carbon-preprocess-svelte report"],
      ["  Detected components (0): none"],
      [
        "  Allowlist: 0 classes (module scan 0 tokens, content 0 tokens, safelist 0 entries)",
      ],
      ["  Assets:"],
    ]);
  });

  test("dry run appends a note to the Assets line", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    printReport({
      components: ["Button"],
      allowlistSize: 10,
      moduleTokens: 0,
      contentTokens: 0,
      safelistEntries: 0,
      assets: [
        {
          id: "styles.css",
          removed: 1,
          beforeBytes: 1000,
          afterBytes: 500,
        },
      ],
      dryRun: true,
    });

    expect(log.mock.calls).toContainEqual([
      "  Assets: (dry run, assets unchanged)",
    ]);
  });
});
