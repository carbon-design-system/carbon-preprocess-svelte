// Shared by the browser tests: the served playground, and a browser per file.

import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "playwright";

/** The playground, served by `run.ts` (or any running instance). */
export const BASE = process.env.PLAYGROUND_URL ?? "http://localhost:4173";

let browser: Browser;
let context: BrowserContext;

/** A browser for this file, closed after it. */
export function useBrowser() {
  beforeAll(async () => {
    browser = await chromium.launch();
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
  });
  afterAll(async () => {
    await browser?.close();
  });
  return () => context;
}

/** Open a page (`KitchenSink`, `Stress`, …) with extra query params; collects page errors. */
export async function open(
  context: BrowserContext,
  query: string,
): Promise<{ page: Page; errors: string[] }> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`${BASE}/?chrome=0&${query}`, { waitUntil: "networkidle" });
  return { page, errors };
}

/** Decode a svelte.dev playground hash, as the playground does. */
export async function decodePlaygroundHash(page: Page, hash: string) {
  const text = await page.evaluate(async (h) => {
    const decoded = atob(h.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    return new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).text();
  }, hash);
  return JSON.parse(text) as {
    name: string;
    files: { name: string; contents: string }[];
  };
}
