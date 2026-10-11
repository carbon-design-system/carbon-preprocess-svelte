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

  test("Reset all, above the page and in Settings, resets every setting", async () => {
    const { page } = await openShell("page=Matrix&syntax=off&pm=bun");
    const tags = page.getByRole("region", { name: "Changed settings" });
    await tags.getByRole("button", { name: "Reset all" }).click();
    await page.waitForTimeout(200);
    expect(await tags.count()).toBe(0);
    expect(new URL(page.url()).search).toBe("?page=Matrix");

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Syntax colors").selectOption("off");
    const reset = page
      .locator(".bx--header-panel")
      .getByRole("button", { name: "Reset all" });
    await reset.click();
    await page.waitForTimeout(200);
    expect(new URL(page.url()).searchParams.get("syntax")).toBeNull();
    expect(await page.getByLabel("Syntax colors").inputValue()).toBe("build");
    expect(await reset.isDisabled()).toBe(true);
    await page.close();
  });

  test("a tall live example scrolls in its region, so its code stays in view", async () => {
    const { page } = await openShell("page=MountBench");
    const example = page.getByRole("region", { name: "Live example" });
    await example.waitFor();
    const box = await example.boundingBox();
    expect(box?.height).toBeLessThanOrEqual(900 / 2 + 1);
    const code = await page.locator(".codeview").first().boundingBox();
    expect(code?.y).toBeLessThan(900);
    await page.close();
  });

  test("search finds a heading on another page and goes to it", async () => {
    const { page, errors } = await openShell("page=MountBench");
    await page.getByRole("button", { name: "Search" }).first().click();
    await page.keyboard.type("code feat");
    const result = page.getByRole("menuitem", { name: /Code features/ });
    expect(await result.textContent()).toContain("Kitchen sink");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);
    expect(new URL(page.url()).hash).toBe("#code-features");
    expect(await page.getByRole("heading", { level: 1 }).textContent()).toBe(
      "Kitchen sink",
    );
    // Below the 48px header, in view.
    const top = await page.evaluate(
      () =>
        document.getElementById("code-features")?.getBoundingClientRect().top,
    );
    expect(top).toBeGreaterThanOrEqual(48);
    expect(top).toBeLessThan(200);
    expect(errors).toEqual([]);
    await page.close();
  });

  test("previous and next follow the side nav", async () => {
    const { page } = await openShell("page=Matrix");
    const nav = page.getByRole("navigation", {
      name: "Previous and next pages",
    });
    expect(await nav.textContent()).toContain("Try markdown()");
    expect(await nav.textContent()).toContain("Stress");
    await nav.getByRole("link", { name: /Next/ }).click();
    await page.waitForTimeout(300);
    expect(new URL(page.url()).searchParams.get("page")).toBe("Stress");
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
