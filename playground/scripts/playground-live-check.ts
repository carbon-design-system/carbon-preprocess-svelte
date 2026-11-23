// Opens a generated "Open in Svelte Playground" URL on svelte.dev and checks
// the project loads and renders: the one check that needs the network, so
// it's a script rather than a CI test.
//
//   bun scripts/playground-live-check.ts
import { chromium } from "playwright";
import { playgroundUrl } from "../src/intel/playground.js";

const url = await playgroundUrl(
  [
    {
      name: "Example.svelte",
      code: '<script>\n  import { Button } from "carbon-components-svelte";\n</script>\n\n<Button>Hello from Carbon</Button>',
    },
  ],
  { theme: "white" },
);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
await page.waitForTimeout(12_000);
const files = await page.evaluate(() => [
  ...new Set(
    document.body.innerText.match(/App\.svelte|Example\.svelte/g) ?? [],
  ),
]);
const frame = page.frames().find((f) => f !== page.mainFrame());
const preview = frame
  ? await frame.evaluate(() => document.body.innerText)
  : "";
await browser.close();
console.log(`files: ${files.join(", ")}\npreview: ${preview.slice(0, 80)}`);
process.exit(
  files.length === 2 && preview.includes("Hello from Carbon") ? 0 : 1,
);
