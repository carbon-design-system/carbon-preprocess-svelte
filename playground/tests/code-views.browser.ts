// Code views: the interactions a reader has with them.
import { decodePlaygroundHash, open, useBrowser } from "./helpers";

const context = useBrowser();
const clipboard = (page: import("playwright").Page) =>
  page.evaluate(() => navigator.clipboard.readText());

describe("code views", () => {
  test("hover cards: underlined from the start, and a card on the first hover", async () => {
    const { page } = await open(context(), "page=KitchenSink");
    const line = page
      .locator(".codeview", { hasText: "RegionPicker.svelte" })
      .locator(".line", { hasText: "function shouldFilterItem" });
    await line.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const underlined = await page.evaluate(
      () => CSS.highlights.get("intel-available")?.size ?? 0,
    );
    expect(underlined).toBeGreaterThan(0);
    const point = await line.locator(".text").evaluate((el) => {
      const text = el.textContent ?? "";
      const range = document.createRange();
      const start = text.indexOf("shouldFilterItem") + 3;
      range.setStart(el.firstChild as Node, start);
      range.setEnd(el.firstChild as Node, start + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(1200);
    const card = page.locator("[role=tooltip]");
    expect(await card.textContent()).toContain("shouldFilterItem");
    // CCS's FloatingPortal places it above the token, inside the viewport.
    const box = await card.boundingBox();
    expect(box && box.y + box.height).toBeLessThanOrEqual(point.y);
    expect(box && box.x + box.width).toBeLessThanOrEqual(1280);
    await page.close();
  });

  test("package manager switch: converts every npm block and keeps the choice in the URL", async () => {
    const { page } = await open(context(), "page=KitchenSink");
    // By its switch: the text changes with the package manager.
    await page
      .locator(".codeview", { hasText: "npm install -D" })
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const block = page.locator(".codeview").filter({
      has: page.getByRole("radiogroup", { name: "Package manager" }),
    });
    await page.waitForTimeout(300);
    await block.getByRole("radio", { name: "bun" }).click();
    expect(await block.locator("code").textContent()).toBe(
      "bun add -d carbon-preprocess-svelte\nbun run dev --open",
    );
    expect(new URL(page.url()).searchParams.get("pm")).toBe("bun");
    await page.close();
  });

  test("terminal sessions: each command copies on its own, continuation lines included", async () => {
    const { page } = await open(context(), "page=KitchenSink");
    const session = page.locator(".codeview", { hasText: "sv create" });
    await session.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const first = session.locator(".line").first();
    await first.hover();
    await first.locator(".line-copy").click();
    expect(await clipboard(page)).toBe(
      "npx sv create my-app \\\n    --template minimal \\\n    --types ts",
    );
    await page.close();
  });

  test("line links: click, shift-click a range, and reload to the lines", async () => {
    const { page } = await open(context(), "page=KitchenSink");
    const block = page.locator(".codeview", { hasText: "formatBytes" });
    await block.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await block.locator(".line-number", { hasText: "14" }).click();
    await block
      .locator(".line-number", { hasText: "17" })
      .click({ modifiers: ["Shift"] });
    await page.waitForTimeout(100);
    const hash = new URL(page.url()).hash;
    expect(hash).toMatch(/^#code-\d+-L14-L17$/);
    expect(await block.locator(".line[data-target]").count()).toBe(4);
    expect(await clipboard(page)).toContain(hash);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const target = page.locator(".line[data-target]").first();
    expect(
      await target.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight;
      }),
    ).toBe(true);
    await page.close();
  });

  test("a link into lines behind Show more expands the block and scrolls to them", async () => {
    const { page } = await open(context(), "page=Stress");
    await page.goto(`${page.url().split("#")[0]}#code-1-L400`, {
      waitUntil: "networkidle",
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const result = await page.evaluate(() => {
      const target = document.querySelector("[data-target]");
      const rect = target?.getBoundingClientRect();
      return {
        expanded: !document.querySelector(".tail")?.hasAttribute("hidden"),
        inView: !!rect && rect.top >= 0 && rect.bottom <= innerHeight,
      };
    });
    expect(result).toEqual({ expanded: true, inView: true });
    await page.close();
  });

  test("Show more: collapsed lines stay findable, and the toggle expands and collapses", async () => {
    const { page } = await open(context(), "page=KitchenSink");
    const block = page
      .locator(".codeview", { hasText: "Rename project" })
      .first();
    await block.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const toggle = block.getByRole("button", { name: /Show/ });
    expect(await toggle.getAttribute("aria-expanded")).toBe("false");
    expect(await block.locator(".tail").getAttribute("hidden")).toBe(
      "until-found",
    );
    await toggle.click();
    expect(await toggle.getAttribute("aria-expanded")).toBe("true");
    expect(await block.locator(".tail").getAttribute("hidden")).toBeNull();
    await page.close();
  });

  test("file tabs: arrow keys select, End reaches the last tab, and it scrolls into view", async () => {
    const { page } = await open(context(), "page=KitchenSink");
    const group = page.locator(".codeview:has([role=tab]:nth-child(8))");
    await group.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await group.getByRole("tab").first().focus();
    await page.keyboard.press("ArrowRight");
    expect(
      await group.getByRole("tab", { selected: true }).textContent(),
    ).toContain("+page.svelte");
    expect(await group.locator(".edge.after").count()).toBe(1);
    await page.keyboard.press("End");
    await page.waitForTimeout(300);
    const visible = await group.evaluate((el) => {
      const tab = el
        .querySelector("[aria-selected=true]")
        ?.getBoundingClientRect();
      const list = el.querySelector(".list")?.getBoundingClientRect();
      return (
        !!tab &&
        !!list &&
        tab.left >= list.left - 1 &&
        tab.right <= list.right + 1
      );
    });
    expect(visible).toBe(true);
    expect(
      await group.getByRole("tabpanel").getAttribute("aria-labelledby"),
    ).toContain("-9");
    await page.close();
  });

  test("folds open and close; synced groups follow each other and persist", async () => {
    const { page } = await open(context(), "page=KitchenSink");
    await page.evaluate(() =>
      localStorage.removeItem("playground:code-groups"),
    );
    await page.reload({ waitUntil: "networkidle" });
    const folded = page
      .locator(".codeview")
      .filter({ has: page.locator(".fold-toggle") })
      .first();
    await folded.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const lines = () => folded.locator(".line:not(.fold-summary)").count();
    expect(await lines()).toBe(8);
    await folded.getByRole("button", { name: "Show 8 lines" }).click();
    expect(await lines()).toBe(16);

    const groups = page.locator(".codeview").filter({
      has: page.getByRole("tab", { name: "Svelte 4", exact: true }),
    });
    await groups.first().scrollIntoViewIfNeeded();
    await groups
      .first()
      .getByRole("tab", { name: "Svelte 4", exact: true })
      .click();
    const selected = () =>
      groups.evaluateAll((els) =>
        els.map((el) =>
          el.querySelector("[aria-selected=true]")?.textContent?.trim(),
        ),
      );
    expect(await selected()).toEqual(["Svelte 4", "Svelte 4"]);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    expect(await selected()).toEqual(["Svelte 4", "Svelte 4"]);
    await page.close();
  });

  test("type errors: a squiggle, a header button, and the message", async () => {
    const { page } = await open(context(), "page=KitchenSink");
    const view = page
      .locator(".codeview", { has: page.locator(".type-errors") })
      .first();
    await view.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    expect(await view.locator(".type-errors").textContent()).toContain(
      "1 type error",
    );
    await view.locator(".type-errors").click();
    await page.waitForTimeout(500);
    const card = await page.locator("[role=tooltip]").textContent();
    expect(card).toContain("TS2353");
    expect(card).toContain('"tooltip"');
    expect(
      await page.evaluate(() => CSS.highlights.get("type-error")?.size ?? 0),
    ).toBeGreaterThan(0);
    await page.close();
  });

  test("Open in Svelte Playground: the example as shown, its modules, and the theme's CSS", async () => {
    const { page } = await open(
      context(),
      "page=KitchenSink&theme=g100&code=ts",
    );
    const framed = page.locator(".codeview").filter({
      has: page.getByRole("tab", { name: "RegionTable.svelte", exact: true }),
    });
    await framed.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const [popup] = await Promise.all([
      context().waitForEvent("page"),
      framed.locator(".action").click(),
    ]);
    const url = popup.url();
    await popup.close();
    expect(url.startsWith("https://svelte.dev/playground/untitled#")).toBe(
      true,
    );
    const project = await decodePlaygroundHash(page, url.split("#")[1]);
    expect(project.files.map((f) => f.name)).toEqual([
      "App.svelte",
      "RegionTable.svelte",
      "regions.js",
    ]);
    expect(project.files[0].contents).toContain("css/g100.css");
    expect(project.files[1].contents).toContain('lang="ts"');
    await page.close();
  });
});
