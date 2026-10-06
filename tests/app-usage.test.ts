import { analyzeFiles } from "../src/analyzer";
import { collectAppUsage } from "../src/analyzer/app-usage";
import { readCarbonComponents } from "../src/analyzer/call-sites";
import { resolveCarbonRoot } from "../src/indexer/resolve-carbon-root";

const carbon = readCarbonComponents(resolveCarbonRoot());
const IMPORT_BUTTON = `import { Button } from "carbon-components-svelte";`;
const MAIN = {
  file: "/app/src/main.ts",
  code: `import App from "./App.svelte";`,
};
const LEGACY_CARD = {
  file: "/app/src/Card.svelte",
  code: `<script>${IMPORT_BUTTON}\nexport let tone = "primary";</script>\n<Button kind={tone}><slot /></Button>`,
};
const RUNES_CARD = {
  file: "/app/src/Card.svelte",
  code: `<script>${IMPORT_BUTTON}\nlet { tone = "primary", children } = $props();</script>\n{#if children}<Button kind={tone}>{@render children()}</Button>{/if}`,
};
const appRendering = (
  markup: string,
  imports = `import Card from "./Card.svelte";`,
) => ({
  file: "/app/src/App.svelte",
  code: `<script>${imports}</script>\n${markup}`,
});

/** The kinds Button can render with, per the analysis of `files`. */
async function buttonKinds(files: Array<{ file: string; code: string }>) {
  const result = await analyzeFiles({
    projectRoot: process.cwd(),
    files,
    components: ["Button"],
    options: {},
  });
  if ("warning" in result) throw new Error(result.warning);
  const kinds = ["primary", "danger", "ghost"].filter(
    (kind) => !result.isPruned(`.bx--btn--${kind}`),
  );
  return kinds;
}

describe("props through the app's own components", () => {
  test("a wrapper passes its callers' props on to Carbon", async () => {
    expect(
      await buttonKinds([
        MAIN,
        appRendering(`<Card tone="danger">Delete</Card>`),
        LEGACY_CARD,
      ]),
    ).toEqual(["danger"]);
    const { closed } = collectAppUsage(
      [MAIN, appRendering(`<Card tone="danger">Delete</Card>`), LEGACY_CARD],
      carbon,
    );
    expect([...closed]).toEqual([LEGACY_CARD.file]);
  });

  test("runes wrappers, defaults, and content passed as `children`", async () => {
    expect(
      await buttonKinds([MAIN, appRendering(`<Card>Save</Card>`), RUNES_CARD]),
    ).toEqual(["primary"]);
    // App markup counts as rendering every call site it holds, live or not.
    expect(
      await buttonKinds([
        MAIN,
        appRendering(`<Card tone="ghost" />`),
        RUNES_CARD,
      ]),
    ).toEqual(["ghost"]);
  });

  test("an app component the analyzed files never import renders with any props", async () => {
    expect(await buttonKinds([MAIN, LEGACY_CARD])).toEqual([
      "primary",
      "danger",
      "ghost",
    ]);
  });

  test.each([
    [
      "an alias",
      appRendering(
        `<Card tone="danger" />`,
        `import Card from "$lib/Card.svelte";`,
      ),
    ],
    ["a value", appRendering(`<svelte:component this={Card} tone="danger" />`)],
    [
      "`import.meta.glob`",
      appRendering(
        `<Card tone="danger" />`,
        `import Card from "./Card.svelte"; const pages = import.meta.glob("./*.svelte");`,
      ),
    ],
    [
      "a computed `import()`",
      appRendering(
        `<Card tone="danger" />`,
        `import Card from "./Card.svelte"; const load = (name) => import(\`./\${name}.svelte\`);`,
      ),
    ],
  ])("a wrapper reached through %s renders with any props", async (_, app) => {
    expect(await buttonKinds([MAIN, app, LEGACY_CARD])).toEqual([
      "primary",
      "danger",
      "ghost",
    ]);
  });

  test("a wrapper's own constants and nested wrappers resolve too", async () => {
    const toolbar = {
      file: "/app/src/Toolbar.svelte",
      code: `<script>import Card from "./Card.svelte";\nexport let destructive = false;\nconst tone = destructive ? "danger" : "ghost";</script>\n<Card {tone} />`,
    };
    expect(
      await buttonKinds([
        MAIN,
        appRendering(`<Toolbar />`, `import Toolbar from "./Toolbar.svelte";`),
        toolbar,
        LEGACY_CARD,
      ]),
    ).toEqual(["ghost"]);
  });
});
