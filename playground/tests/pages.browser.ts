// Every page loads without errors, with and without the loading techniques.
import { open, useBrowser } from "./helpers";

const context = useBrowser();
const PAGES = [
  "KitchenSink",
  "Matrix",
  "Stress",
  "MountBench",
  "InteractBench",
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
