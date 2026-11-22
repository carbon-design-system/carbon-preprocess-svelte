import {
  analyzeFiles,
  type UsageOptions,
} from "svelte-prune/internal/analysis";
import { CARBON, CSS_FAILURE } from "../src/carbon-library";
import {
  type CssOptimizerOptions,
  collectedEngine,
  createCssOptimizer,
  optimizeCssWithReport,
  cssUsage,
} from "../src/plugins/create-optimized-css";

const RE_ACCORDION = /accordion/;

const analyzer = await import("svelte-prune/internal/analysis");

const BUTTON_CSS =
  ".bx--btn{a:1}.bx--btn--tertiary{a:2}.bx--btn--danger{a:3}.bx--btn--sm{a:4}.bx--accordion{a:5}";
const APP = `<script>
  import { Button } from "carbon-components-svelte";
</script>
<Button kind="tertiary">Hi</Button>`;

/** The optimizer's analysis for an app that renders `code`. */
async function analysis(
  code = APP,
  options: UsageOptions = {},
): Promise<Pick<CssOptimizerOptions, "analysis" | "engine">> {
  const result = await analyzeFiles({
    library: CARBON,
    failure: CSS_FAILURE,
    projectRoot: process.cwd(),
    files: [{ file: "/app/App.svelte", code }],
    components: ["Button"],
    options,
  });
  if ("warning" in result) throw new Error(result.warning);
  return {
    analysis: cssUsage(result, analyzer),
    engine: collectedEngine(result, analyzer, process.cwd(), [{ code }]),
  };
}

describe("createCssOptimizer", () => {
  test("prunes what the app's props never render", async () => {
    const { css } = optimizeCssWithReport({
      source: BUTTON_CSS,
      ...(await analysis()),
    });
    expect(css).toBe(".bx--btn{a:1}.bx--btn--tertiary{a:2}");
  });

  test("with every component excluded, prunes only what nothing renders", async () => {
    const { css } = optimizeCssWithReport({
      source: BUTTON_CSS,
      ...(await analysis(APP, { exclude: ["Button"] })),
    });
    expect(css).toContain(".bx--btn--danger");
    expect(css).not.toContain(".bx--accordion");
  });

  test("leaves CSS unpruned without an analysis", () => {
    const optimizer = createCssOptimizer({});
    expect(optimizer.prunes).toBe(false);
    expect(optimizer.run(BUTTON_CSS)).toEqual({ css: BUTTON_CSS, removed: 0 });
  });

  test("skips stylesheets with nothing of Carbon's", async () => {
    const optimizer = createCssOptimizer(await analysis());
    const css = ".app{color:red}";
    expect(optimizer.run(css)).toEqual({ css, removed: 0 });
  });

  test("keeps the classes the app's code names, exactly or by prefix", async () => {
    const { css } = optimizeCssWithReport({
      source: BUTTON_CSS,
      ...(await analysis()),
      contentClasses: [".bx--accordion", ".bx--btn--"],
    });
    expect(css).toContain(".bx--accordion");
    // `bx--btn--${kind}`: every class it can build stays.
    expect(css).toContain(".bx--btn--danger");
    expect(css).toContain(".bx--btn--sm");
  });

  test("keeps what `safelist` names", async () => {
    const { css } = optimizeCssWithReport({
      source: BUTTON_CSS,
      ...(await analysis()),
      safelist: [".bx--btn--sm", RE_ACCORDION],
    });
    expect(css).toContain(".bx--btn--sm");
    expect(css).toContain(".bx--accordion");
  });

  test("counts what it removes, and reports what can render", async () => {
    const optimizer = createCssOptimizer(await analysis());
    expect(optimizer.run(BUTTON_CSS).removed).toBe(3);
    expect(optimizer.usage.components).toContain("Button");
    expect(optimizer.usage.components).toEqual(
      [...optimizer.usage.components].sort(),
    );
    expect([...optimizer.usage.prunedByProps]).toContain(".bx--btn--danger");
  });
});
