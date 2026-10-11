// Code-view cost on a page: main-thread time, longest task, and hover handling.
// bun perf-check.ts "<query>"
import { chromium } from "playwright";

const query = process.argv[2] ?? "page=Stress";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const cdp = await p.context().newCDPSession(p);
await cdp.send("Performance.enable");
await p.addInitScript(() => {
  window.__long = [];
  new PerformanceObserver((list) =>
    window.__long.push(...list.getEntries().map((e) => e.duration)),
  ).observe({ type: "longtask", buffered: true });
});
// Warm the dev server's transform cache, then measure a fresh load.
await p.goto(
  `${process.env.PLAYGROUND_URL ?? "http://localhost:5173"}/?chrome=0&${query}`,
  { waitUntil: "networkidle" },
);
await p.goto(
  `${process.env.PLAYGROUND_URL ?? "http://localhost:5173"}/?chrome=0&${query}`,
  { waitUntil: "networkidle" },
);
await p.waitForTimeout(800);
const metrics = Object.fromEntries(
  (await cdp.send("Performance.getMetrics")).metrics.map((m) => [
    m.name,
    m.value,
  ]),
);
const page = await p.evaluate(() => ({
  long: window.__long,
  fcp: Math.round(
    performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0,
  ),
  views: document.querySelectorAll("pre[data-codeview]").length,
  lines: document.querySelectorAll("pre[data-codeview] .line").length,
  nodes: document.getElementsByTagName("*").length,
  ranges: [...CSS.highlights.values()].reduce((n, h) => n + h.size, 0),
}));
// Hover: 200 pointer moves across the big block.
const big = p.locator("pre[data-codeview]").first();
const box = await big.boundingBox();
const hoverMs = await p.evaluate(
  async ([x, y]) => {
    const pre = document.querySelector("pre[data-codeview]");
    if (!pre) return Number.POSITIVE_INFINITY;
    const t = performance.now();
    for (let i = 0; i < 200; i++)
      pre.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: x + (i % 60) * 8,
          clientY: y + 40 + (i % 20) * 20,
          bubbles: true,
        }),
      );
    return (performance.now() - t) / 200;
  },
  [(box?.x ?? 0) + 60, box?.y ?? 0],
);
console.log(
  JSON.stringify({
    tbtMs: Math.round(
      page.long.reduce((sum, d) => sum + Math.max(0, d - 50), 0),
    ),
    scriptMs: Math.round(metrics.ScriptDuration * 1000),
    layoutMs: Math.round(metrics.LayoutDuration * 1000),
    styleMs: Math.round(metrics.RecalcStyleDuration * 1000),
    longTasks: page.long.map(Math.round),
    ...page,
    hoverMsPerMove: +hoverMs.toFixed(3),
  }),
);
await b.close();
