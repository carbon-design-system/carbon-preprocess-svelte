import type { PropAwareOptions } from "../src/analyzer/analyze-usage";
import { analyzeUsage } from "../src/analyzer/analyze-usage";
import {
  type collectImportedUsage,
  collectScriptUsage,
  collectSourceUsage,
  collectSvelteUsage,
  readCarbonComponents,
} from "../src/analyzer/call-sites";
import {
  buildComponentModel,
  UnsupportedComponentError,
} from "../src/analyzer/component-model";
import { UNKNOWN } from "../src/analyzer/values";
import { resolveCarbonRoot } from "../src/indexer/resolve-carbon-root";

const carbonRoot = resolveCarbonRoot();
const carbon = readCarbonComponents(carbonRoot);
const BUTTON = "Button/Button.svelte";

function app(script: string, markup: string): string {
  return `<script>\n${script}\n</script>\n\n${markup}\n`;
}

const IMPORT_BUTTON = `import { Button } from "carbon-components-svelte";`;

async function analyze(code: string, options?: PropAwareOptions) {
  const usage = collectSvelteUsage(code, "/app/App.svelte", carbon);
  return analyzeUsage({
    carbonRoot,
    carbon,
    bundled: usage.sites.map((site) => site.component),
    modules: [usage],
    options,
  });
}

describe("collectSvelteUsage", () => {
  test("reads literal props and filled slots", () => {
    const { sites } = collectSvelteUsage(
      app(
        IMPORT_BUTTON,
        `<Button kind="tertiary" size={"small"} disabled>Hi</Button>`,
      ),
      "/app/App.svelte",
      carbon,
    );
    expect(sites).toHaveLength(1);
    const [site] = sites;
    expect(site.component).toBe(BUTTON);
    expect(site.open).toBe(false);
    expect(site.props.get("kind")).toEqual(new Set(["tertiary"]));
    expect(site.props.get("size")).toEqual(new Set(["small"]));
    expect(site.props.get("disabled")).toEqual(new Set([true]));
    expect(site.slots).toEqual(new Set(["default"]));
    expect(site.location).toEqual({ file: "/app/App.svelte", line: 5 });
  });

  test("an expression, a bind, or a spread leaves props unknown", () => {
    const { sites } = collectSvelteUsage(
      app(
        `${IMPORT_BUTTON}\nlet kind = "ghost"; let ref;`,
        `<Button {kind} bind:ref /><Button {...$$restProps} />`,
      ),
      "/app/App.svelte",
      carbon,
    );
    expect(sites[0].props.get("kind")).toBe(UNKNOWN);
    expect(sites[0].props.get("ref")).toBe(UNKNOWN);
    expect(sites[1].open).toBe(true);
  });

  test("a component used as a value, or never rendered as a tag, is open", () => {
    const asValue = collectSvelteUsage(
      app(IMPORT_BUTTON, `<svelte:component this={Button} />`),
      "/app/App.svelte",
      carbon,
    );
    expect(asValue.sites.map((site) => [site.open, site.reason])).toEqual([
      [true, "used as a value"],
    ]);

    // Markup another preprocessor generates is invisible to the parser.
    const unrendered = collectSvelteUsage(
      `<script>${IMPORT_BUTTON}</script>\n<template lang="pug">Button</template>`,
      "/app/App.svelte",
      carbon,
    );
    expect(unrendered.sites.every((site) => site.open)).toBe(true);
    expect(unrendered.sites).toHaveLength(1);
  });

  test("direct-path and namespace imports", () => {
    const direct = collectSvelteUsage(
      app(
        `import Button from "carbon-components-svelte/src/Button/Button.svelte";`,
        `<Button kind="ghost" />`,
      ),
      "/app/App.svelte",
      carbon,
    );
    expect(direct.sites[0].props.get("kind")).toEqual(new Set(["ghost"]));

    const namespaced = collectSvelteUsage(
      app(
        `import * as C from "carbon-components-svelte";`,
        `<C.Button kind="ghost" />`,
      ),
      "/app/App.svelte",
      carbon,
    );
    expect(namespaced.openAll).toBe(false);
    expect(namespaced.sites[0].component).toBe(BUTTON);

    const namespaceAsValue = collectSvelteUsage(
      app(
        `import * as C from "carbon-components-svelte";`,
        `<svelte:component this={C[name]} />`,
      ),
      "/app/App.svelte",
      carbon,
    );
    expect(namespaceAsValue.openAll).toBe(true);
  });

  test("snippets make slots unknown; slot attributes name them", () => {
    const { sites } = collectSvelteUsage(
      app(
        IMPORT_BUTTON,
        `<Button><span slot="icon" /></Button><Button>{#snippet icon()}x{/snippet}</Button>`,
      ),
      "/app/App.svelte",
      carbon,
    );
    expect(sites[0].slots).toEqual(new Set(["icon"]));
    expect(sites[1].slots).toBeNull();
  });
});

describe("collectScriptUsage", () => {
  test("every import or re-export of a component is open", () => {
    const usage = collectScriptUsage(
      `import { Button } from "carbon-components-svelte";\nexport { Modal } from "carbon-components-svelte";`,
      "/app/ui.js",
      carbon,
    );
    expect(usage.sites.map((site) => [site.component, site.open])).toEqual([
      [BUTTON, true],
      ["Modal/Modal.svelte", true],
    ]);
    expect(
      collectScriptUsage(
        `export * from "carbon-components-svelte";`,
        "/app/ui.js",
        carbon,
      ).openAll,
    ).toBe(true);
  });
});

describe("collectImportedUsage", () => {
  const open = (usage: ReturnType<typeof collectImportedUsage>) =>
    usage.sites.map((site) => [site.component, site.open, site.location?.line]);

  test("an Astro or Markdown file's imports are open", () => {
    const astro = `---
import { Button, type ButtonProps, Modal as M } from "carbon-components-svelte";
import type { DataTableHeader } from "carbon-components-svelte";
import Tile from "carbon-components-svelte/src/Tile/Tile.svelte";
---
<Button kind="ghost" client:load>Isn't parsed</Button>`;
    const usage = collectSourceUsage(astro, "/app/index.astro", carbon);
    expect(open(usage)).toEqual([
      [BUTTON, true, 2],
      ["Modal/Modal.svelte", true, 2],
      ["Tile/Tile.svelte", true, 4],
    ]);
    expect(usage.openAll).toBe(false);
  });

  test("any other mention of the package opens every component", () => {
    for (const code of [
      `<script>import * as C from "carbon-components-svelte";</script>`,
      `export * from "carbon-components-svelte";`,
      `const C = await import('carbon-components-svelte');`,
    ]) {
      expect(collectSourceUsage(code, "/app/page.md", carbon).openAll).toBe(
        true,
      );
    }
  });

  test("a `.svelte` file that doesn't parse falls back to its imports", () => {
    const usage = collectSourceUsage(
      `<script>${IMPORT_BUTTON}</script>\n<Button kind={"ghost"}>{#if}</Button>`,
      "/app/App.svelte",
      carbon,
    );
    expect(open(usage)).toEqual([[BUTTON, true, 1]]);
    expect(usage.sites[0].reason).toBe("could not be parsed");
  });
});

describe("analyzeUsage", () => {
  test("one tertiary button prunes other kinds, sizes, skeleton and tooltip", async () => {
    const { isPruned, liveComponents } = await analyze(
      app(IMPORT_BUTTON, `<Button kind="tertiary">Hi</Button>`),
    );
    expect(isPruned(".bx--btn")).toBe(false);
    expect(isPruned(".bx--btn--tertiary")).toBe(false);
    for (const cls of [
      ".bx--btn--danger",
      ".bx--btn--primary",
      ".bx--btn--sm",
      ".bx--btn--icon-only",
      ".bx--skeleton",
      ".bx--tooltip__trigger",
    ]) {
      expect(isPruned(cls)).toBe(true);
    }
    expect([...liveComponents]).toEqual([BUTTON]);
  });

  test("a dynamic or spread prop keeps every value", async () => {
    const dynamic = await analyze(
      app(`${IMPORT_BUTTON}\nexport let kind;`, `<Button {kind}>Hi</Button>`),
    );
    expect(dynamic.isPruned(".bx--btn--danger")).toBe(false);

    const spread = await analyze(app(IMPORT_BUTTON, `<Button {...props} />`));
    expect(spread.isPruned(".bx--btn--danger")).toBe(false);
    expect(spread.isPruned(".bx--skeleton")).toBe(false);
  });

  test("`assume` narrows a dynamic prop; `exclude` keeps everything", async () => {
    const code = app(
      `${IMPORT_BUTTON}\nexport let kind;`,
      `<Button {kind}>Hi</Button>`,
    );
    const assumed = await analyze(code, {
      assume: { Button: { kind: ["danger"] } },
    });
    expect(assumed.isPruned(".bx--btn--danger")).toBe(false);
    expect(assumed.isPruned(".bx--btn--ghost")).toBe(true);

    const excluded = await analyze(
      app(IMPORT_BUTTON, `<Button kind="tertiary">Hi</Button>`),
      { exclude: ["Button"] },
    );
    expect(excluded.isPruned(".bx--btn--danger")).toBe(false);
  });

  test("props flow into the components a component renders", async () => {
    // Pagination renders `<Button kind="ghost" …>`.
    const pagination = await analyze(
      app(
        `import { Pagination } from "carbon-components-svelte";`,
        `<Pagination totalItems={10} />`,
      ),
    );
    expect(pagination.isPruned(".bx--btn--ghost")).toBe(false);
    expect(pagination.isPruned(".bx--btn--danger")).toBe(true);

    // Modal's danger prop picks its primary button's kind.
    const IMPORT_MODAL = `import { Modal } from "carbon-components-svelte";`;
    const danger = await analyze(
      app(IMPORT_MODAL, `<Modal danger primaryButtonText="OK">Body</Modal>`),
    );
    expect(danger.isPruned(".bx--btn--danger")).toBe(false);
  });

  test("a Modal without secondary buttons prunes their styles", async () => {
    const IMPORT_MODAL = `import { Modal } from "carbon-components-svelte";`;
    const THREE_BUTTONS = ".bx--modal-footer--three-button";
    const without = await analyze(
      app(IMPORT_MODAL, `<Modal open modalHeading="Hi">Body</Modal>`),
    );
    expect(without.isPruned(THREE_BUTTONS)).toBe(true);
    const withButtons = await analyze(
      app(
        IMPORT_MODAL,
        `<Modal open secondaryButtons={[{ text: "A" }, { text: "B" }]}>Body</Modal>`,
      ),
    );
    expect(withButtons.isPruned(THREE_BUTTONS)).toBe(false);
  });

  test("follows components imported through a `.js` barrel", async () => {
    const { isPruned } = await analyze(
      app(
        `import { MultiSelect } from "carbon-components-svelte";`,
        `<MultiSelect items={[{ id: "a", text: "A" }]} />`,
      ),
    );
    // Rendered by ListBoxField, which MultiSelect imports from `../ListBox`.
    expect(isPruned(".bx--list-box__field")).toBe(false);
  });

  test("runes-mode components are rejected, not guessed at", () => {
    expect(() =>
      buildComponentModel(
        `<script>let { kind } = $props();</script>`,
        "X/X.svelte",
      ),
    ).toThrow(UnsupportedComponentError);
  });
});
