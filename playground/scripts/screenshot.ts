// Screenshots of a running playground (`bun run dev`, or PLAYGROUND_URL):
//
//   bun scripts/screenshot.ts <name> "<query>"                    # full page
//   bun scripts/screenshot.ts <name> "<query>" --sections         # one image per h2
//   bun scripts/screenshot.ts <name> "<query>" --element "<sel>"  # one element
//   bun scripts/screenshot.ts <name> "<query>" --viewport "#id"   # the viewport, scrolled to a heading
//
// Writes to `screenshots/` (or SCREENSHOTS). Full-page shots turn off lazy
// mounting and content-visibility, which would leave skipped blocks blank.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [name, query = "", mode, arg] = process.argv.slice(2);
if (!name) {
  console.error(
    'Usage: bun scripts/screenshot.ts <name> "<query>" [--sections | --element <selector> | --viewport <#id>]',
  );
  process.exit(1);
}
const BASE = process.env.PLAYGROUND_URL ?? "http://localhost:5173";
const OUT = path.resolve(
  process.env.SCREENSHOTS ?? path.join(import.meta.dirname, "../screenshots"),
);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const eager = mode === "--viewport" ? "" : "lazy=0&cv=0&";
await page.goto(`${BASE}/?chrome=0&${eager}${query}`, {
  waitUntil: "networkidle",
});
await page.waitForTimeout(500);

if (mode === "--sections") {
  const boxes = await page.evaluate(() => {
    const headings = [...document.querySelectorAll("h2[id]")];
    const end = document.documentElement.scrollHeight;
    return headings.map((h, i) => {
      const top = h.getBoundingClientRect().top + scrollY - 24;
      const next = headings[i + 1]
        ? headings[i + 1].getBoundingClientRect().top + scrollY - 24
        : end;
      return { id: h.id, y: Math.max(0, top), height: next - top };
    });
  });
  for (const box of boxes) {
    // biome-ignore lint/performance/noAwaitInLoops: one screenshot at a time
    await page.screenshot({
      path: path.join(OUT, `${name}-${box.id}.png`),
      fullPage: true,
      clip: { x: 40, y: box.y, width: 760, height: box.height },
    });
  }
  console.log(boxes.map((b) => `${name}-${b.id}.png`).join("\n"));
} else if (mode === "--element") {
  await page
    .locator(arg)
    .first()
    .screenshot({ path: path.join(OUT, `${name}.png`) });
} else if (mode === "--viewport") {
  if (arg)
    await page.evaluate(
      (id) => document.querySelector(id)?.scrollIntoView(),
      arg,
    );
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
} else {
  await page.screenshot({
    path: path.join(OUT, `${name}.png`),
    fullPage: true,
  });
}
await browser.close();
