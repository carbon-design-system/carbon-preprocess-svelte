// Every page loads without errors, with and without the loading techniques.
import { open, useBrowser } from "./helpers";

const context = useBrowser();
const PAGES = [
  "KitchenSink",
  "Try",
  "Options",
  "Matrix",
  "Stress",
  "MountBench",
  "InteractBench",
  "BuildReport",
  "Readme",
  "Contributing",
  "PlaygroundReadme",
];

describe("pages", () => {
  for (const name of PAGES) {
    for (const flags of ["", "lazy=0&cv=0&aot=0"]) {
      test(`${name}${flags ? ` (${flags})` : ""} loads without errors`, async () => {
        const { page, errors } = await open(context(), `page=${name}&${flags}`);
        await page.waitForTimeout(300);
        expect(errors).toEqual([]);
        await page.close();
      });
    }
  }

  test("the kitchen sink renders code views, a live example, and a framed example", async () => {
    const { page } = await open(context(), "page=KitchenSink");
    expect(await page.locator(".codeview").count()).toBeGreaterThan(20);
    expect(await page.locator(".example").count()).toBeGreaterThan(2);
    expect(await page.getByText("Framed example: RegionTable").count()).toBe(1);
    await page.close();
  });
});

describe("options gallery", () => {
  test("each option's variants render differently", async () => {
    const { page, errors } = await open(context(), "page=Options");
    const row = (id: string) =>
      page.locator(`h2#${id} ~ .gallery-row`).first().locator("figure");
    // alerts: a blockquote, then Carbon's InlineNotification.
    expect(await row("alerts").nth(0).locator("blockquote").count()).toBe(2);
    expect(
      await row("alerts").nth(1).locator(".bx--inline-notification").count(),
    ).toBe(2);
    // codeSnippet: a <pre>, then CodeSnippet.
    expect(
      await row("codesnippet").nth(1).locator(".bx--snippet").count(),
    ).toBe(1);
    // expressions: literal braces, then evaluated.
    expect(await row("expressions").nth(0).textContent()).toContain("{2 + 2}");
    expect(await row("expressions").nth(1).textContent()).toContain(
      "Two and two make 4",
    );
    // anchors: none, every heading, h2 only.
    const anchors = (n: number) =>
      row("anchors").nth(n).locator("a[href^='#']").count();
    expect([await anchors(0), await anchors(1), await anchors(2)]).toEqual([
      0, 2, 1,
    ]);
    expect(errors).toEqual([]);
    await page.close();
  });
});

describe("build report", () => {
  test("lists the examples' CSS and each file's import rewrites", async () => {
    const { page, errors } = await open(context(), "page=BuildReport");
    const examples = page.locator("h2#css-across-the-examples ~ .table table");
    expect(await examples.textContent()).toContain("astro");
    expect(await examples.textContent()).toContain("+ optimizeComponents");
    // The last build, or how to make one (a fresh checkout has none yet).
    expect(
      await page
        .getByText(/optimizeComponents|No build yet/)
        .first()
        .isVisible(),
    ).toBe(true);
    const app = page.getByRole("row", { name: /src\/App\.svelte/ });
    await app.getByRole("button").click();
    const diff = page.locator("[data-child-row] .codeview").first();
    expect(await diff.textContent()).toContain(
      "carbon-components-svelte/src/UIShell/Header.svelte",
    );
    expect(errors).toEqual([]);
    await page.close();
  });
});

describe("the repo's docs", () => {
  test("the README renders, with Markdown inside its <details> and links to GitHub", async () => {
    const { page, errors } = await open(context(), "page=Readme");
    expect(await page.getByRole("heading", { level: 1 }).textContent()).toBe(
      "carbon-preprocess-svelte",
    );
    // Its intro, as text: the badges drop out.
    expect(await page.locator(".intro").textContent()).toMatch(
      /^Zero-dependency Svelte preprocessors/,
    );
    // A fence inside <details> is a code view, not raw text.
    expect(await page.locator("details .codeview").count()).toBeGreaterThan(0);
    expect(
      await page
        .locator(
          "a[href^='https://github.com/carbon-design-system/carbon-preprocess-svelte/blob/main/examples/']",
        )
        .count(),
    ).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    await page.close();
  });
});
