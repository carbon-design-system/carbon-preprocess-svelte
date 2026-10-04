/**
 * Interaction check for the vite-matrix examples: drives each optimized
 * build (`css`, `prop-aware`, `full`) through the same script of clicks,
 * typing, hovers and key presses as `baseline`, and requires the same DOM
 * and the same pixels after every step. Covers what the SSR checks can't:
 * hydration/mounting, state changes, and styles only interaction reveals
 * (open menus, focus, hover, modals).
 *
 *   bun scripts/eval-interactions.ts [--examples vite-matrix@svelte-5] [--no-build]
 *
 * Each example needs its dependencies installed, with this package linked
 * (see the example's README). Builds every variant unless `--no-build`.
 * Artifacts for any mismatch land in `.context/eval-interactions/`.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { $ } from "bun";
import { type Browser, chromium, type Page } from "playwright";

const { values: args } = parseArgs({
  options: {
    examples: { type: "string" },
    "no-build": { type: "boolean" },
  },
});

const ROOT = path.resolve(import.meta.dir, "..");
const OUT = path.join(ROOT, ".context/eval-interactions");
const EXAMPLES = (
  args.examples ?? "vite-matrix@svelte-4,vite-matrix@svelte-5"
).split(",");
const VARIANTS = ["baseline", "css", "prop-aware", "full"];

type Step = { name: string; run: (page: Page) => Promise<unknown> };

/** One pass through the vite-matrix app. Every step runs on every variant. */
const STEPS: Step[] = [
  { name: "load", run: async () => {} },
  {
    name: "hover tooltip definition",
    run: (page) => page.getByRole("button", { name: "routing rules" }).hover(),
  },
  {
    name: "type a name",
    run: (page) =>
      page.getByRole("textbox", { name: "Name" }).first().fill("edge-lb"),
  },
  {
    name: "show password",
    run: async (page) => {
      await page.getByLabel("API key").fill("secret");
      await page.getByRole("button", { name: "Show password" }).click();
    },
  },
  {
    name: "increment number",
    run: async (page) => {
      // The password toggle's tooltip stays open while it has focus, and
      // covers this button.
      await page.mouse.move(0, 0);
      await page.keyboard.press("Tab");
      await page.getByRole("button", { name: "Increment number" }).click();
    },
  },
  {
    name: "select protocol",
    run: (page) => page.getByLabel("Protocol").selectOption("http"),
  },
  {
    name: "check, toggle, radio",
    run: async (page) => {
      await page.getByText("Enable health checks").click();
      await page.getByText("Sticky sessions").click();
      await page.getByText("Least connections").click();
    },
  },
  {
    name: "open dropdown",
    run: (page) => page.getByRole("combobox", { name: "Region" }).click(),
  },
  {
    name: "choose dropdown item",
    run: (page) => page.getByRole("option", { name: "US West" }).click(),
  },
  {
    name: "filter combo box",
    run: (page) => page.getByPlaceholder("Select a region").fill("EU"),
  },
  {
    name: "choose combo box item",
    run: (page) => page.getByRole("option", { name: "EU Germany" }).click(),
  },
  {
    name: "open multiselect",
    run: (page) =>
      page.getByRole("combobox").filter({ hasText: "Select zones" }).click(),
  },
  {
    name: "select two zones",
    run: async (page) => {
      await page.getByRole("option", { name: "US East" }).click();
      await page.getByRole("option", { name: "US West" }).click();
    },
  },
  {
    name: "close multiselect",
    run: (page) => page.keyboard.press("Escape"),
  },
  {
    name: "details tab, expand accordion",
    run: async (page) => {
      await page.getByRole("tab", { name: "Details" }).click();
      await page.getByRole("button", { name: "Health checks" }).click();
    },
  },
  {
    name: "balancers tab, sort by name",
    run: async (page) => {
      await page.getByRole("tab", { name: "Balancers" }).click();
      const header = page.getByRole("button", { name: "Name" });
      await header.click();
      await header.click();
    },
  },
  {
    name: "search table",
    run: (page) => page.getByRole("searchbox").fill("1"),
  },
  {
    name: "clear search, next page",
    run: async (page) => {
      await page.getByRole("searchbox").fill("");
      await page.getByRole("button", { name: "Next page" }).click();
    },
  },
  {
    name: "open modal",
    run: async (page) => {
      await page.getByRole("button", { name: "Add balancer" }).click();
      await page.getByRole("dialog").getByLabel("Name").fill("new-lb");
    },
  },
  {
    name: "close modal",
    run: (page) =>
      page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click(),
  },
  {
    name: "save, notification",
    run: (page) => page.getByRole("button", { name: "Save settings" }).click(),
  },
  {
    name: "close notification",
    run: (page) =>
      page.getByRole("button", { name: "Close notification" }).click(),
  },
  {
    name: "keyboard focus",
    run: async (page) => {
      await page.locator("body").click({ position: { x: 1, y: 1 } });
      for (let i = 0; i < 6; i++) {
        // biome-ignore lint/performance/noAwaitInLoops: key presses run in order
        await page.keyboard.press("Tab");
      }
    },
  },
];

/** Same ids on every run: Carbon generates them with `Math.random`. */
const SEED_RANDOM = `{
  let seed = 1;
  Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}`;

const COMMENT = /<!--[\s\S]*?-->/g;
const CARBON_ID = /\bccs-[a-z0-9]+/g;
const CLASS_ATTR = /class="([^"]*)"/g;
const WHITESPACE = /\s+/;

/**
 * `document.body` serialized with each element's attributes sorted: a
 * folded value becomes a static attribute, which Svelte sets when it creates
 * the element, so it comes earlier than a dynamic one would.
 */
function serializeSorted(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  for (const element of [clone, ...clone.querySelectorAll("*")]) {
    const attributes = [...element.attributes]
      .map((a) => [a.name, a.value] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    for (const [name] of attributes) element.removeAttribute(name);
    for (const [name, value] of attributes) element.setAttribute(name, value);
  }
  return clone.outerHTML;
}

/**
 * The DOM with what legitimately differs removed: comments (Svelte's block
 * anchors move when blocks are rewritten), generated ids (numbered by first
 * appearance), and spacing inside `class`.
 */
function normalizeDom(html: string): string {
  const ids = new Map<string, string>();
  return html
    .replace(COMMENT, "")
    .replace(CARBON_ID, (id) => {
      let stable = ids.get(id);
      if (!stable) {
        stable = `ccs-${ids.size}`;
        ids.set(id, stable);
      }
      return stable;
    })
    .replace(
      CLASS_ATTR,
      (_, value: string) =>
        `class="${value.trim().split(WHITESPACE).join(" ")}"`,
    );
}

/** Lets transitions and pending updates settle. */
async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished)),
  );
  await page.waitForTimeout(300);
}

type Capture = { dom: string; png: Buffer; error?: string };

async function runScenario(browser: Browser, url: string): Promise<Capture[]> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await context.addInitScript(SEED_RANDOM);
  // Only the app itself: no web fonts or other network, for stable pixels.
  await context.route(
    (requestUrl) => !requestUrl.href.startsWith(url),
    (route) => route.abort(),
  );
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForSelector(".bx--header");

  const captures: Capture[] = [];
  for (const step of STEPS) {
    let error: string | undefined;
    try {
      // biome-ignore lint/performance/noAwaitInLoops: steps run in order
      await step.run(page);
    } catch (e) {
      error = (e as Error).message.split("\n")[0];
    }
    await settle(page);
    captures.push({
      dom: normalizeDom(await page.evaluate(serializeSorted)),
      png: await page.screenshot({
        fullPage: true,
        animations: "disabled",
        caret: "hide",
      }),
      error,
    });
  }
  await context.close();
  return captures;
}

function serve(dir: string) {
  return Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      const file = Bun.file(
        path.join(dir, pathname === "/" ? "index.html" : pathname),
      );
      return new Response(file);
    },
  });
}

type Mismatch = {
  example: string;
  variant: string;
  step: string;
  kind: string;
};

rmSync(OUT, { recursive: true, force: true });
const browser = await chromium.launch();
const mismatches: Mismatch[] = [];
const scriptErrors: string[] = [];

for (const example of EXAMPLES) {
  const dir = path.join(ROOT, "examples", example);
  if (!existsSync(path.join(dir, "node_modules"))) {
    throw new Error(
      `${example}: install its dependencies first (see its README)`,
    );
  }
  const captures = new Map<string, Capture[]>();
  for (const variant of VARIANTS) {
    if (!args["no-build"]) {
      // biome-ignore lint/performance/noAwaitInLoops: one build at a time
      await $`cd ${dir} && VARIANT=${variant} bun x vite build --logLevel error`.quiet();
    }
    const server = serve(path.join(dir, "dist", variant));
    captures.set(variant, await runScenario(browser, server.url.href));
    server.stop(true);
  }

  const baseline = captures.get("baseline") ?? [];
  for (const [i, step] of STEPS.entries()) {
    const expected = baseline[i];
    if (expected.error) {
      scriptErrors.push(
        `${example} baseline "${step.name}": ${expected.error}`,
      );
    }
    for (const variant of VARIANTS.slice(1)) {
      const actual = (captures.get(variant) ?? [])[i];
      const kinds = [
        actual.error !== expected.error &&
          `step ${actual.error ? `failed: ${actual.error}` : "succeeded only here"}`,
        actual.dom !== expected.dom && "DOM differs",
        !actual.png.equals(expected.png) && "pixels differ",
      ].filter(Boolean) as string[];
      if (kinds.length === 0) continue;
      mismatches.push({
        example,
        variant,
        step: step.name,
        kind: kinds.join(", "),
      });
      const artifacts = path.join(
        OUT,
        example,
        `${String(i).padStart(2, "0")}-${step.name.replace(/\W+/g, "-")}`,
      );
      mkdirSync(artifacts, { recursive: true });
      for (const [name, capture] of [
        ["baseline", expected],
        [variant, actual],
      ] as const) {
        writeFileSync(path.join(artifacts, `${name}.png`), capture.png);
        writeFileSync(path.join(artifacts, `${name}.html`), capture.dom);
      }
    }
  }

  const failed = mismatches.filter((m) => m.example === example).length;
  console.log(
    `${example}: ${STEPS.length} steps × ${VARIANTS.length - 1} variants vs baseline: ${failed === 0 ? "identical DOM and pixels" : `${failed} mismatches`}`,
  );
}
await browser.close();

for (const error of scriptErrors)
  console.log(`  script error (fix the step): ${error}`);
for (const m of mismatches) {
  console.log(`  MISMATCH ${m.example} ${m.variant} "${m.step}": ${m.kind}`);
}
if (mismatches.length > 0)
  console.log(`\nArtifacts: ${path.relative(ROOT, OUT)}/`);
process.exit(mismatches.length > 0 || scriptErrors.length > 0 ? 1 : 0);
