// Performance budgets: no main-thread freeze at load or while scrolling, and
// cheap hover. Generous for shared CI machines; `PLAYGROUND_LONG_TASK_MS`
// tightens or loosens the load budget.
import { open, useBrowser } from "./helpers";

const context = useBrowser();
const LONG_TASK_MS = Number(process.env.PLAYGROUND_LONG_TASK_MS ?? 200);

describe("performance", () => {
  for (const name of ["KitchenSink", "Stress"]) {
    test(`${name}: no load task over ${LONG_TASK_MS} ms, and smooth scrolling`, async () => {
      const page = await context().newPage();
      await page.addInitScript(() => {
        window.__long = [];
        new PerformanceObserver((list) =>
          window.__long.push(...list.getEntries().map((e) => e.duration)),
        ).observe({ type: "longtask", buffered: true });
      });
      const { BASE } = await import("./helpers");
      const url = `${BASE}/?chrome=0&page=${name}`;
      // Warm the HTTP cache once: the budget is for the app, not the network.
      await page.goto(url, { waitUntil: "networkidle" });
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      const load = await page.evaluate(() => window.__long);
      console.log(
        `${name}: longest load task ${Math.round(Math.max(0, ...load))} ms`,
      );
      expect(Math.max(0, ...load)).toBeLessThan(LONG_TASK_MS);

      const scroll = await page.evaluate(async () => {
        const long: number[] = [];
        new PerformanceObserver((list) =>
          long.push(...list.getEntries().map((e) => e.duration)),
        ).observe({ type: "longtask" });
        for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
          scrollTo(0, y);
          // biome-ignore lint/performance/noAwaitInLoops: scrolling step by step, as a reader does
          await new Promise((r) => setTimeout(r, 50));
        }
        await new Promise((r) => setTimeout(r, 300));
        return long;
      });
      console.log(
        `${name}: longest scroll task ${Math.round(Math.max(0, ...scroll))} ms`,
      );
      expect(Math.max(0, ...scroll)).toBeLessThan(LONG_TASK_MS);
      await page.close();
    });
  }

  // Layout shift (CLS) while each page loads and settles: Mount cost until
  // it has measured everything, the others for a second and a half.
  const CLS_BUDGET = 0.005;
  for (const name of [
    "KitchenSink",
    "Try",
    "Matrix",
    "Stress",
    "MountBench",
    "InteractBench",
  ]) {
    test(`${name}: layout shift under ${CLS_BUDGET}`, async () => {
      const page = await context().newPage();
      await page.addInitScript(() => {
        window.__shifts = [];
        new PerformanceObserver((list) =>
          window.__shifts.push(
            ...list
              .getEntries()
              .map((e) => (e as unknown as { value: number }).value),
          ),
        ).observe({ type: "layout-shift", buffered: true });
      });
      const { BASE } = await import("./helpers");
      const url = `${BASE}/?chrome=0&page=${name}`;
      // Warm the HTTP cache (fonts included): the budget is for the app.
      await page.goto(url, { waitUntil: "networkidle" });
      await page.goto(url, { waitUntil: "networkidle" });
      if (name === "MountBench") {
        await page.waitForSelector("#bench-results[data-done]", {
          state: "attached",
          timeout: 60_000,
        });
      }
      await page.waitForTimeout(1500);
      const shifts = await page.evaluate(() => window.__shifts);
      const cls = shifts.reduce((sum, value) => sum + value, 0);
      console.log(
        `${name}: ${shifts.length} layout shifts, CLS ${cls.toFixed(4)}`,
      );
      expect(cls).toBeLessThan(CLS_BUDGET);
      await page.close();
    });
  }

  test("hover handling costs under a millisecond per pointer move", async () => {
    const { page } = await open(context(), "page=Stress");
    const box = await page.locator("pre[data-codeview]").first().boundingBox();
    const ms = await page.evaluate(
      ([x, y]) => {
        const pre = document.querySelector("pre[data-codeview]");
        if (!pre) return Number.POSITIVE_INFINITY;
        const start = performance.now();
        for (let i = 0; i < 200; i++) {
          pre.dispatchEvent(
            new PointerEvent("pointermove", {
              clientX: x + (i % 60) * 8,
              clientY: y + 40 + (i % 20) * 20,
              bubbles: true,
            }),
          );
        }
        return (performance.now() - start) / 200;
      },
      [(box?.x ?? 0) + 60, box?.y ?? 0],
    );
    expect(ms).toBeLessThan(1);
    await page.close();
  });
});
