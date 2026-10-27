// @reads golden/**
import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { buildGolden, GOLDEN_VARIANTS } from "../scripts/golden-build";
import { GOLDEN_SCENARIOS } from "../scripts/golden-steps";

const ROOT = path.join(import.meta.dir, "..");
const OUT = path.join(ROOT, ".context/golden-sizes");

/** Total size of the built `.css` and `.js` assets, in kB. */
function assetSizes(dir: string): { css_kb: number; js_kb: number } {
  const assets = path.join(dir, "assets");
  let css = 0;
  let js = 0;
  for (const file of readdirSync(assets)) {
    const size = statSync(path.join(assets, file)).size;
    if (file.endsWith(".css")) css += size;
    else if (file.endsWith(".js")) js += size;
  }
  const kb = (bytes: number) => Math.round(bytes / 10.24) / 100;
  return { css_kb: kb(css), js_kb: kb(js) };
}

// What each golden app ships in every build variant: a change that moves
// these shows up here, not just in a PR description. Update with
// `bun test tests/golden-sizes.test.ts --update-snapshots`.
describe("golden app sizes", () => {
  afterAll(() => rmSync(OUT, { recursive: true, force: true }));

  test.each(Object.keys(GOLDEN_SCENARIOS))(
    "%s",
    async (app) => {
      const sizes: Record<string, { css_kb: number; js_kb: number }> = {};
      for (const variant of GOLDEN_VARIANTS) {
        const outDir = path.join(OUT, app, variant);
        // biome-ignore lint/performance/noAwaitInLoops: one build at a time
        await buildGolden(path.join(ROOT, "golden", app), variant, outDir);
        sizes[variant] = assetSizes(outDir);
      }
      expect(sizes).toMatchSnapshot();
    },
    60_000,
  );
});
