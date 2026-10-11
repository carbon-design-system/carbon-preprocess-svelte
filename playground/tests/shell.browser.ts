// The playground's shell: Carbon's UI Shell, the settings panel, and the
// changed-settings tags.
import path from "node:path";
import { BASE, useBrowser } from "./helpers";

const context = useBrowser();
const AXE = path.join(
  import.meta.dirname,
  "../node_modules/axe-core/axe.min.js",
);

async function openShell(query = "") {
  const page = await context().newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${BASE}/?${query}`, { waitUntil: "networkidle" });
  return { page, errors };
}

describe("shell", () => {
  test("the side nav goes to a page and marks it", async () => {
    const { page, errors } = await openShell();
    await page
      .getByRole("navigation", { name: "Pages" })
      .getByRole("link", { name: "Matrix" })
      .click();
    await page.waitForTimeout(300);
    expect(new URL(page.url()).searchParams.get("page")).toBe("Matrix");
    expect(await page.getByRole("heading", { level: 1 }).textContent()).toBe(
      "Matrix",
    );
    expect(
      await page.locator(".bx--side-nav__link--current").textContent(),
    ).toContain("Matrix");
    expect(errors).toEqual([]);
    await page.close();
  });

  test("a setting changes the URL and shows as a tag; dismissing the tag resets it", async () => {
    const { page } = await openShell();
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Syntax colors").selectOption("off");
    await page.waitForTimeout(200);
    expect(new URL(page.url()).searchParams.get("syntax")).toBe("off");
    const tags = page.getByRole("region", { name: "Changed settings" });
    expect(await tags.textContent()).toContain("Syntax colors: Off");
    await tags.getByRole("button", { name: /Syntax colors/ }).click();
    await page.waitForTimeout(200);
    expect(new URL(page.url()).searchParams.get("syntax")).toBeNull();
    expect(
      await page.getByRole("region", { name: "Changed settings" }).count(),
    ).toBe(0);
    await page.close();
  });

  test("settings from the URL show as changed", async () => {
    const { page } = await openShell("code=ts&pm=bun");
    const tags = page.getByRole("region", { name: "Changed settings" });
    expect(await tags.textContent()).toContain("Example language: TypeScript");
    expect(await tags.textContent()).toContain("Package manager: bun");
    await page.close();
  });

  test("without Prose, a notice says so and Prose's settings are off", async () => {
    const { page } = await openShell();
    const notice = page.locator(".bx--inline-notification", {
      hasText: "No Prose.",
    });
    expect(await notice.count()).toBe(1);
    await page.getByRole("button", { name: "Settings" }).click();
    expect(await page.getByLabel("Variant").isDisabled()).toBe(true);
    expect(await page.getByLabel("Syntax colors").isDisabled()).toBe(false);
    await page.close();
  });

  test("axe finds no violations in the shell, with the settings panel open", async () => {
    const { page } = await openShell();
    await page.getByRole("button", { name: "Settings" }).click();
    await page.waitForTimeout(300);
    await page.addScriptTag({ path: AXE });
    const result = await page.evaluate(() =>
      window.axe.run(
        { include: [["header"], ["nav"], [".bx--header-panel"]] },
        { resultTypes: ["violations"] },
      ),
    );
    expect(result.violations.map((v) => `${v.id} (${v.nodes.length})`)).toEqual(
      [],
    );
    await page.close();
  });
});
