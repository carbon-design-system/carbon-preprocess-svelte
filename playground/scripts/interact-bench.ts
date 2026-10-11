// Interaction latency (Event Timing: input to next paint) for large CCS components.
import { chromium } from "playwright";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(
  `${process.env.PLAYGROUND_URL ?? "http://localhost:5173"}/?chrome=0&lazy=0&page=InteractBench`,
  { waitUntil: "networkidle" },
);
await p.waitForTimeout(500);
await p.evaluate(() => {
  window.__events = [];
  new PerformanceObserver((list) =>
    window.__events.push(
      ...list.getEntries().map((e) => ({ name: e.name, duration: e.duration })),
    ),
  ).observe({
    type: "event",
    durationThreshold: 16,
    buffered: true,
  } as PerformanceObserverInit);
});
async function measure(label: string, action: () => Promise<void>) {
  await p.evaluate(() => (window.__events = []));
  await action();
  await p.waitForTimeout(400);
  const events = await p.evaluate(() => window.__events);
  const worst = events.reduce((m, e) => Math.max(m, e.duration), 0);
  console.log(
    `${label.padEnd(44)} worst interaction ${String(Math.round(worst)).padStart(4)} ms  (${events.length} events over 16 ms)`,
  );
}
for (const id of ["combo-virtual", "combo-plain"]) {
  // biome-ignore lint/performance/noAwaitInLoops: interactions happen one after another
  await measure(`${id}: open`, async () => {
    await p.locator(`#${id} input`).click();
  });
  await measure(`${id}: type "Option 4"`, async () => {
    await p.keyboard.type("Option 4", { delay: 30 });
  });
  await measure(`${id}: clear and close`, async () => {
    await p.keyboard.press("Escape");
    await p.keyboard.press("Escape");
  });
}
await measure("dropdown: open", async () => {
  await p.locator("#dropdown button").first().click();
});
await measure("dropdown: close", async () => {
  await p.keyboard.press("Escape");
});
await measure("multiselect: open", async () => {
  await p.locator("#multiselect input").click();
});
await measure('multiselect: type "9"', async () => {
  await p.keyboard.type("9", { delay: 30 });
});
await measure("multiselect: select first", async () => {
  await p.keyboard.press("ArrowDown");
  await p.keyboard.press("Enter");
});
await p.keyboard.press("Escape");
await measure("datatable (1,000 rows): sort by port", async () => {
  await p.locator("#table th button", { hasText: "Port" }).click();
});
await measure('datatable: search "balancer 99"', async () => {
  await p.locator("#table input").fill("");
  await p.locator("#table input").type("balancer 99", { delay: 30 });
});
await p.locator("#table-virtual").scrollIntoViewIfNeeded();
await measure("datatable virtualize: sort by port", async () => {
  await p.locator("#table-virtual th button", { hasText: "Port" }).click();
});
await measure('datatable virtualize: search "balancer 99"', async () => {
  await p.locator("#table-virtual input").type("balancer 99", { delay: 30 });
});
await b.close();
