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
    await page.getByLabel("Markdown").fill("# Draft");
    await page.waitForTimeout(300);
    await page.reload({ waitUntil: "networkidle" });
    expect(await page.getByLabel("Markdown").inputValue()).toBe("# Draft");
    await page.getByRole("button", { name: "Reset" }).click();
    expect(await page.getByLabel("Markdown").inputValue()).toContain(
      "# Getting started",
    );
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
