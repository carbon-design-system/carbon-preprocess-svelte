import { analyzeFiles, specializeFiles } from "../src/analyzer";
import { collectAppUsage } from "../src/analyzer/app-usage";
import { readCarbonComponents } from "../src/analyzer/call-sites";
import { resolveCarbonRoot } from "../src/indexer/resolve-carbon-root";

const carbon = readCarbonComponents(resolveCarbonRoot());
const KIND_REASSIGNED =
  /kind +dynamic: Card\.svelte:5 `kind` is assigned at line 3/;
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
async function buttonKinds(
  files: Array<{ file: string; code: string }>,
  // The bundle; a listed component no file renders keeps every variant.
  components = ["Button"],
) {
  const result = await analyzeFiles({
    projectRoot: process.cwd(),
    files,
    components,
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
    // No content: `children` is undefined, so `{#if children}` renders
    // nothing and the Button has no call site at all.
    const { modules } = collectAppUsage(
      [MAIN, appRendering(`<Card tone="ghost" />`), RUNES_CARD],
      carbon,
    );
    expect(modules.flatMap((module) => module.sites)).toEqual([]);
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

describe("props a component spreads into its children", () => {
  const IMPORT_ACTION = `import { HeaderGlobalAction } from "carbon-components-svelte";`;

  test("`{...$$restProps}` passes what call sites pass and the parent doesn't declare", async () => {
    // HeaderGlobalAction spreads $$restProps into a Button.
    expect(
      await buttonKinds(
        [
          MAIN,
          appRendering(`<HeaderGlobalAction kind="ghost" />`, IMPORT_ACTION),
        ],
        ["HeaderGlobalAction"],
      ),
    ).toEqual(["ghost"]);
    // Without `kind`, the Button keeps its default.
    expect(
      await buttonKinds(
        [MAIN, appRendering(`<HeaderGlobalAction />`, IMPORT_ACTION)],
        ["HeaderGlobalAction"],
      ),
    ).toEqual(["primary"]);
  });

  test("a site that spreads its own props keeps the child open", async () => {
    expect(
      await buttonKinds(
        [
          MAIN,
          appRendering(`<HeaderGlobalAction {...props} />`, IMPORT_ACTION),
        ],
        ["HeaderGlobalAction"],
      ),
    ).toEqual(["primary", "danger", "ghost"]);
  });

  test("attributes after a spread win; before it, the spread may override them", async () => {
    const card = (markup: string) => ({
      file: "/app/src/Card.svelte",
      code: `<script>${IMPORT_BUTTON}</script>\n${markup}`,
    });
    const files = (markup: string, site: string) => [
      MAIN,
      appRendering(site),
      card(markup),
    ];
    expect(
      await buttonKinds(
        files(
          `<Button {...$$restProps} kind="danger" />`,
          `<Card kind="ghost" />`,
        ),
      ),
    ).toEqual(["danger"]);
    expect(
      await buttonKinds(
        files(
          `<Button kind="danger" {...$$restProps} />`,
          `<Card kind="ghost" />`,
        ),
      ),
    ).toEqual(["ghost"]);
    // A site that leaves `kind` out keeps the value set before the spread.
    expect(
      await buttonKinds(
        files(
          `<Button kind="danger" {...$$restProps} />`,
          `<Card kind="ghost" /><Card />`,
        ),
      ),
    ).toEqual(["danger", "ghost"]);
  });

  test("runes: `...rest` from `$props()` works like `$$restProps`", async () => {
    const card = {
      file: "/app/src/Card.svelte",
      code: `<script>${IMPORT_BUTTON}\nlet { tone = "ghost", ...rest } = $props();</script>\n<Button {...rest} size={rest.size}>{tone}</Button>`,
    };
    expect(
      await buttonKinds([MAIN, appRendering(`<Card kind="danger" />`), card]),
    ).toEqual(["danger"]);
  });
});

describe("why a value is unknown", () => {
  test("the report says where and why a prop lost its value", async () => {
    const card = {
      file: "/app/src/Card.svelte",
      code: `<script>${IMPORT_BUTTON}
let kind = "ghost";
const pick = (next) => (kind = next);
</script>
<Button {kind} on:click={() => pick("danger")} />`,
    };
    const result = await specializeFiles({
      projectRoot: process.cwd(),
      files: [MAIN, appRendering(`<Card />`), card],
    });
    if ("warning" in result) throw new Error(result.warning);
    expect(result.report().join("\n")).toMatch(KIND_REASSIGNED);
  });
});

describe("branches in app markup", () => {
  const app = (script: string, markup: string) => ({
    file: "/app/src/App.svelte",
    code: `<script>${IMPORT_BUTTON}\n${script}</script>\n${markup}`,
  });

  test("a call site in a branch that can't render doesn't count", async () => {
    expect(
      await buttonKinds([
        MAIN,
        app(
          `const advanced = false;`,
          `{#if advanced}<Button kind="danger" />{:else}<Button kind="ghost" />{/if}`,
        ),
      ]),
    ).toEqual(["ghost"]);
  });

  test("a component only a dead branch renders isn't open", () => {
    const { modules } = collectAppUsage(
      [
        MAIN,
        app(
          `import { Modal } from "carbon-components-svelte";`,
          `{#if false}<Modal open />{/if}<Button kind="ghost" />`,
        ),
      ],
      carbon,
    );
    const sites = modules.flatMap((module) => module.sites);
    expect(sites.map((site) => [site.component, site.open])).toEqual([
      ["Button/Button.svelte", false],
    ]);
  });

  test("`{#each}` over an app literal reads its items", async () => {
    expect(
      await buttonKinds([
        MAIN,
        app(
          `const actions = [{ label: "Save", kind: "ghost" }, { label: "Delete", kind: "danger" }];`,
          `{#each actions as action}<Button kind={action.kind}>{action.label}</Button>{/each}`,
        ),
      ]),
    ).toEqual(["danger", "ghost"]);
  });
});

describe("constants imported from the app's own modules", () => {
  const constants = {
    file: "/app/src/lib/constants.ts",
    code: `export const ACTION_KIND: "ghost" | "danger" = "ghost";
export let mode = "danger";
export function setMode(next: string) { mode = next; }
export const DEFAULTS = { kind: "danger" };`,
  };
  const app = (imports: string, markup: string) => ({
    file: "/app/src/App.svelte",
    code: `<script>${IMPORT_BUTTON}\n${imports}</script>\n${markup}`,
  });

  test("a constant passes its value", async () => {
    expect(
      await buttonKinds([
        MAIN,
        constants,
        app(
          `import { ACTION_KIND } from "./lib/constants";`,
          `<Button kind={ACTION_KIND} />`,
        ),
      ]),
    ).toEqual(["ghost"]);
  });

  test.each([
    [`import { mode } from "./lib/constants";`, `<Button kind={mode} />`],
    [
      `import { DEFAULTS } from "./lib/constants";`,
      `<Button kind={DEFAULTS.kind} />`,
    ],
  ])(
    "a reassigned export or an exported object stays unknown (%s)",
    async (imports, markup) => {
      expect(
        await buttonKinds([MAIN, constants, app(imports, markup)]),
      ).toEqual(["primary", "danger", "ghost"]);
    },
  );
});
