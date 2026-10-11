// The Try page: markdown() compiled in the browser as you type.
import path from "node:path";
import { open, useBrowser } from "./helpers";

const context = useBrowser();
const AXE = path.join(
  import.meta.dirname,
  "../node_modules/axe-core/axe.min.js",
);

async function openTry() {
  const opened = await open(context(), "page=Try");
  await opened.page.evaluate(() => localStorage.removeItem("playground:try"));
  await opened.page.reload({ waitUntil: "networkidle" });
  return opened;
}

describe("try", () => {
  test("typing compiles: the preview, the Svelte output, and the headings follow", async () => {
    const { page, errors } = await openTry();
    await page
      .getByLabel("Markdown")
      .fill("# Hello\n\nSome **bold** text.\n\n## Next");
    await page.waitForTimeout(400);
    const preview = page.getByRole("region", { name: "Preview" });
    expect(await preview.locator("h1").textContent()).toBe("Hello");
    expect(await preview.locator("strong").textContent()).toBe("bold");
    expect(await page.getByText(/compiled in [\d.]+ ms/).count()).toBe(1);

    await page.getByRole("tab", { name: "Svelte" }).click();
    await page.waitForTimeout(300);
    const svelte = await page.locator(".codeview").textContent();
    expect(svelte).toContain("<Prose {...proseProps}>");
    expect(svelte).toContain('<h2 id="next">');

    await page.getByRole("tab", { name: "Headings and metadata" }).click();
    await page.waitForTimeout(300);
    expect(await page.locator(".codeview").textContent()).toContain(
      '"id": "next"',
    );
    expect(errors).toEqual([]);
    await page.close();
  });

  test("compiles once per edit, and not while idle", async () => {
    const { page } = await openTry();
    await page.getByLabel("Markdown").fill("# Once");
    await page.waitForTimeout(400);
    const count = () =>
      page.evaluate(() => performance.getEntriesByName("try:compile").length);
    const before = await count();
    await page.waitForTimeout(1000);
    expect(await count()).toBe(before);
    await page.close();
  });

  test("components show as placeholders, with a note", async () => {
    const { page } = await openTry();
    await page.getByLabel("Start from").selectOption("svelte");
    await page.waitForTimeout(400);
    const preview = page.getByRole("region", { name: "Preview" });
    expect(await preview.locator(".try-placeholder").textContent()).toContain(
      "<Button> renders here",
    );
    expect(await page.getByText("Markdown only.").count()).toBe(1);
    await page.close();
  });

  test("the draft survives a reload, and Reset restores the sample", async () => {
    const { page } = await openTry();
    // Nothing to reset yet.
    expect(
      await page
        .getByRole("button", { name: "Reset to the sample" })
        .isDisabled(),
    ).toBe(true);
    await page.getByLabel("Markdown").fill("# Draft");
    await page.waitForTimeout(300);
    await page.reload({ waitUntil: "networkidle" });
    expect(await page.getByLabel("Markdown").inputValue()).toBe("# Draft");
    const reset = page.getByRole("button", { name: "Reset to the sample" });
    expect(await reset.isDisabled()).toBe(false);
    await reset.click();
    expect(await reset.isDisabled()).toBe(true);
    expect(await page.getByLabel("Markdown").inputValue()).toContain(
      "# Getting started",
    );
    await page.close();
  });

  test("options change the Svelte output, and Svelte's compiler checks it", async () => {
    const { page } = await openTry();
    await page.getByLabel("Markdown").fill("> [!TIP]\n> Hi.");
    await page
      .getByRole("checkbox", { name: 'alerts: "InlineNotification"' })
      .check({ force: true });
    await page.getByRole("tab", { name: "Svelte" }).last().click();
    await page.waitForTimeout(1500);
    expect(await page.locator(".codeview").textContent()).toContain(
      "<InlineNotification",
    );
    expect(await page.getByText("Svelte compiles this.").count()).toBe(1);

    await page.getByLabel("Markdown").fill('<img src="x" onerror="go()">');
    await page.waitForTimeout(1500);
    expect(await page.getByText("Svelte can't compile this.").count()).toBe(1);
    expect(await page.getByText(/^Line \d+:/).count()).toBe(1);
    await page.close();
  });

  test("the preview drops what runs code", async () => {
    const { page } = await openTry();
    await page
      .getByLabel("Markdown")
      .fill(
        '<img src="x" onerror="window.__ran = 1">\n\n<a href="javascript:window.__ran = 2">link</a>\n\n<script>window.__ran = 3</script>',
      );
    await page.waitForTimeout(600);
    const preview = page.getByRole("region", { name: "Preview" });
    expect(await preview.locator("[onerror], script").count()).toBe(0);
    expect(await preview.locator("a").getAttribute("href")).toBeNull();
    expect(await page.evaluate(() => "__ran" in window)).toBe(false);
    await page.close();
  });

  test("a shared link opens its draft without replacing the reader's own", async () => {
    let { page } = await openTry();
    await page.getByLabel("Markdown").fill("# Mine");
    await page.waitForTimeout(400);
    // The link for a different draft.
    await page.getByLabel("Markdown").fill("# Shared");
    await page.waitForTimeout(400);
    await page
      .getByRole("button", { name: "Copy a link to this draft" })
      .click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toContain("#draft=");
    await page.getByLabel("Markdown").fill("# Mine");
    await page.waitForTimeout(400);

    // A new tab, as a reader opens a link (a hash change alone doesn't reload).
    await page.close();
    page = await context().newPage();
    await page.goto(link, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    expect(await page.getByLabel("Markdown").inputValue()).toBe("# Shared");
    expect(await page.getByText("A shared draft.").count()).toBe(1);
    await page.getByLabel("Markdown").fill("# Shared, edited");
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Back to my draft" }).click();
    await page.waitForTimeout(300);
    expect(await page.getByLabel("Markdown").inputValue()).toBe("# Mine");
    await page.close();
  });

  test("axe finds no violations", async () => {
    const { page } = await openTry();
    await page.addScriptTag({ path: AXE });
    const result = await page.evaluate(() =>
      window.axe.run(document, { resultTypes: ["violations"] }),
    );
    expect(result.violations.map((v) => `${v.id} (${v.nodes.length})`)).toEqual(
      [],
    );
    await page.close();
  });
});
