import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { optimizeCss } from "carbon-preprocess-svelte/plugins/optimize-css";

/** Minimal view of the Vite plugin hooks we exercise directly. */
type PluginHooks = {
  transform: (code: string, id: string) => unknown;
  generateBundle: (
    options: unknown,
    bundle: Record<string, { type: string; source: string }>,
  ) => Promise<void>;
};

const BUTTON_ID =
  "/project/node_modules/carbon-components-svelte/src/Button/Button.svelte";

const CSS = [
  ".bx--btn { a: 1 }",
  ".bx--btn--sm { b: 2 }",
  ".bx--btn--lg { c: 3 }",
  ".bx--btn--xl { d: 4 }",
  ".bx--btn--expressive { e: 5 }",
].join("\n");

function writeApp(markup: string): string {
  const dir = mkdtempSync(join(tmpdir(), "cps-optimize-css-"));
  const file = join(dir, "App.svelte");
  writeFileSync(
    file,
    `<script>import { Button } from "carbon-components-svelte";</script>\n${markup}`,
  );
  return file;
}

async function run(appFile: string, experimental: boolean): Promise<string> {
  const plugin = optimizeCss({
    silent: true,
    experimental: { prunePropClasses: experimental },
  }) as unknown as PluginHooks;

  plugin.transform("", BUTTON_ID);
  plugin.transform("", appFile);

  const bundle = { "bundle.css": { type: "asset", source: CSS } };
  await plugin.generateBundle({}, bundle);
  return bundle["bundle.css"].source;
}

describe("optimizeCss experimental prop pruning (end-to-end)", () => {
  test("prunes prop-gated classes the app never reaches", async () => {
    const result = await run(writeApp(`<Button size="sm" />`), true);

    // Used + unconditional classes survive.
    expect(result).toContain(".bx--btn ");
    expect(result).toContain(".bx--btn--sm");
    // Unreachable variants are pruned.
    expect(result).not.toContain(".bx--btn--lg");
    expect(result).not.toContain(".bx--btn--xl");
    expect(result).not.toContain(".bx--btn--expressive");
  });

  test("keeps a variant once the app uses that prop value", async () => {
    const result = await run(writeApp(`<Button size="xl" />`), true);
    expect(result).toContain(".bx--btn--xl");
    expect(result).not.toContain(".bx--btn--lg");
  });

  test("bails to conservative on a dynamic <svelte:component>", async () => {
    const result = await run(
      writeApp(`<Button size="sm" />\n<svelte:component this={Which} />`),
      true,
    );
    // Kill-switch: nothing prop-pruned.
    expect(result).toContain(".bx--btn--lg");
    expect(result).toContain(".bx--btn--expressive");
  });

  test("does nothing extra when the flag is off", async () => {
    const result = await run(writeApp(`<Button size="sm" />`), false);
    expect(result).toContain(".bx--btn--lg");
    expect(result).toContain(".bx--btn--xl");
    expect(result).toContain(".bx--btn--expressive");
  });
});
