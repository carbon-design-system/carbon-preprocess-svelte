/**
 * Interaction check for the examples that build optimized variants: drives
 * each optimized build through the same script of clicks, typing, hovers
 * and key presses as the unoptimized one, and requires the same DOM and the
 * same pixels after every step. Covers what the SSR checks can't: mounting,
 * state changes, and styles only interaction reveals (open menus, focus,
 * hover, modals).
 *
 * - `vite-matrix@svelte-4`, `vite-matrix@svelte-5`: Vite, `baseline` vs
 *   `css`, `prop-aware` and `full`.
 * - `sveltekit-matrix@svelte-5`: the same app prerendered by SvelteKit and
 *   hydrated. Also requires the same prerendered HTML, the same console
 *   messages, and no extra DOM removed while hydrating (a hydration mismatch
 *   throws the server markup away and renders again).
 * - `rollup`, `rolldown`, `webpack`, `webpack@svelte-5`, `rspack`:
 *   `default` vs `optimized`, on a DataTable app.
 * - `astro`: the same, prerendered by Astro and hydrated (`client:load`),
 *   with the SvelteKit example's SSR checks.
 *
 *   bun scripts/eval-interactions.ts [--examples rollup,rspack] [--no-build]
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
const MATRIX_VARIANTS = ["baseline", "css", "prop-aware", "full"];

type Step = { name: string; run: (page: Page) => Promise<unknown> };

/** One pass through the vite-matrix app. Every step runs on every variant. */
const MATRIX_STEPS: Step[] = [
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

/** The Rollup, Rolldown, webpack and Rspack examples' app: a sortable, selectable DataTable. */
const DATATABLE_STEPS: Step[] = [
  { name: "load", run: async () => {} },
  {
    name: "sort by name",
    run: async (page) => {
      const header = page.getByRole("button", { name: "Name" });
      await header.click();
      await header.click();
    },
  },
  // Carbon's checkbox inputs are visually hidden; users click the label.
  {
    name: "select a row",
    run: (page) =>
      page.locator(".bx--table-column-checkbox label").nth(1).click(),
  },
  {
    name: "select all rows",
    run: (page) =>
      page.locator(".bx--table-column-checkbox label").first().click(),
  },
  {
    name: "hover a row",
    run: (page) => page.getByRole("cell", { name: "Load Balancer 1" }).hover(),
  },
  {
    name: "keyboard focus",
    run: async (page) => {
      await page.locator("body").click({ position: { x: 1, y: 1 } });
      for (let i = 0; i < 4; i++) {
        // biome-ignore lint/performance/noAwaitInLoops: key presses run in order
        await page.keyboard.press("Tab");
      }
    },
  },
];

type Example = {
  /** The first variant is the reference the others must match. */
  variants: string[];
  /** Output directory of a variant, relative to the example. */
  outDir: (variant: string) => string;
  /** An element present once the app has rendered. */
  ready: string;
  steps: Step[];
  /** Prerendered and hydrated: also compare the server HTML and hydration. */
  ssr?: boolean;
};

const EXAMPLE_SPECS: Record<string, Example> = {
  "vite-matrix@svelte-4": {
    variants: MATRIX_VARIANTS,
    outDir: (variant) => `dist/${variant}`,
    ready: ".bx--header",
    steps: MATRIX_STEPS,
  },
  "vite-matrix@svelte-5": {
    variants: MATRIX_VARIANTS,
    outDir: (variant) => `dist/${variant}`,
    ready: ".bx--header",
    steps: MATRIX_STEPS,
  },
  "sveltekit-matrix@svelte-5": {
    variants: MATRIX_VARIANTS,
    outDir: (variant) => `build/${variant}`,
    ready: ".bx--header",
    steps: MATRIX_STEPS,
    ssr: true,
  },
  astro: {
    variants: ["default", "optimized"],
    outDir: (variant) => (variant === "default" ? "dist" : `dist-${variant}`),
    ready: ".bx--data-table",
    steps: DATATABLE_STEPS,
    ssr: true,
  },
  ...Object.fromEntries(
    ["rollup", "rolldown", "webpack", "webpack@svelte-5", "rspack"].map(
      (name): [string, Example] => [
        name,
        {
          variants: ["default", "optimized"],
          outDir: (variant) =>
            variant === "default" ? "public" : `public-${variant}`,
          ready: ".bx--data-table",
          steps: DATATABLE_STEPS,
        },
      ],
    ),
  ),
};

const EXAMPLES = args.examples
  ? args.examples.split(",")
  : Object.keys(EXAMPLE_SPECS);

/**
 * Counts elements removed from the document: a hydration mismatch throws
 * the server-rendered markup away, which a clean hydration doesn't.
 */
const COUNT_REMOVALS = `{
  window.__removedElements = 0;
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.removedNodes) {
        if (node.nodeType === 1) window.__removedElements++;
      }
    }
  }).observe(document, { childList: true, subtree: true });
}`;

/** Same ids on every run: Carbon generates them with `Math.random`. */
const SEED_RANDOM = `{
  let seed = 1;
  Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}`;

const COMMENT = /<!--[\s\S]*?-->/g;
const CARBON_ID = /\bccs-[a-z0-9]+/g;
const CLASS_ATTR = /class="([^"]*)"/g;
const WHITESPACE = /\s+/;
/** Astro's island attributes that name hashed files or a random id. */
const ASTRO_ISLAND_ATTR = /\s(?:component-url|renderer-url|uid)="[^"]*"/g;

/**
 * `document.body` (or `html`'s body) serialized without scripts and with
 * each element's attributes sorted: a
 * folded value becomes a static attribute, which Svelte sets when it creates
 * the element, so it comes earlier than a dynamic one would.
 */
function serializeSorted(html?: string): string {
  const body = html
    ? new DOMParser().parseFromString(html, "text/html").body
    : document.body;
  const clone = body.cloneNode(true) as HTMLElement;
  // Scripts are build output, not rendered UI: their hashed file names and
  // SvelteKit's per-build bootstrap differ between any two builds.
  for (const script of clone.querySelectorAll("script")) script.remove();
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
    .replace(ASTRO_ISLAND_ATTR, "")
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

type Run = {
  captures: Capture[];
  /** SSR examples: the prerendered `<body>`, normalized like `dom`. */
  serverHtml?: string;
  /** SSR examples: elements removed by the time the app is ready. */
  removedWhileHydrating?: number;
  /** Console errors and warnings, and uncaught exceptions. */
  messages: string[];
};

async function runScenario(
  browser: Browser,
  url: string,
  spec: Example,
): Promise<Run> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await context.addInitScript(SEED_RANDOM);
  if (spec.ssr) await context.addInitScript(COUNT_REMOVALS);
  // Only the app itself: no web fonts or other network, for stable pixels.
  await context.route(
    (requestUrl) => !requestUrl.href.startsWith(url),
    (route) => route.abort(),
  );
  const page = await context.newPage();
  const messages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      messages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => messages.push(`uncaught: ${error.message}`));

  let serverHtml: string | undefined;
  let removedWhileHydrating: number | undefined;
  if (spec.ssr) {
    const html = await (await fetch(url)).text();
    serverHtml = normalizeDom(await page.evaluate(serializeSorted, html));
  }
  await page.goto(url);
  await page.waitForSelector(spec.ready);
  if (spec.ssr) {
    await settle(page);
    removedWhileHydrating = await page.evaluate(
      () =>
        (window as unknown as { __removedElements: number }).__removedElements,
    );
  }

  const captures: Capture[] = [];
  for (const step of spec.steps) {
    let error: string | undefined;
    try {
      // biome-ignore lint/performance/noAwaitInLoops: steps run in order
      await step.run(page);
    } catch (e) {
      error = (e as Error).message.split("\n")[0];
    }
    await settle(page);
    captures.push({
      dom: normalizeDom(await page.evaluate(serializeSorted, undefined)),
      png: await page.screenshot({
        fullPage: true,
        animations: "disabled",
        caret: "hide",
      }),
      error,
    });
  }
  await context.close();
  return { captures, serverHtml, removedWhileHydrating, messages };
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
  const spec = EXAMPLE_SPECS[example];
  if (!spec) throw new Error(`no interaction scenario for ${example}`);
  const dir = path.join(ROOT, "examples", example);
  if (!existsSync(path.join(dir, "node_modules"))) {
    throw new Error(
      `${example}: install its dependencies first (see its README)`,
    );
  }
  const runs = new Map<string, Run>();
  for (const variant of spec.variants) {
    if (!args["no-build"]) {
      // biome-ignore lint/performance/noAwaitInLoops: one build at a time
      await $`cd ${dir} && bun run build:${variant}`.quiet();
    }
    const server = serve(path.join(dir, spec.outDir(variant)));
    runs.set(variant, await runScenario(browser, server.url.href, spec));
    server.stop(true);
  }

  const [reference, ...optimized] = spec.variants;
  const expectedRun = runs.get(reference) as Run;
  const report = (variant: string, step: string, kind: string) =>
    mismatches.push({ example, variant, step, kind });

  for (const variant of optimized) {
    const actualRun = runs.get(variant) as Run;
    if (actualRun.serverHtml !== expectedRun.serverHtml) {
      report(variant, "prerendered HTML", "differs");
      const artifacts = path.join(OUT, example, "prerendered");
      mkdirSync(artifacts, { recursive: true });
      writeFileSync(
        path.join(artifacts, `${reference}.html`),
        expectedRun.serverHtml ?? "",
      );
      writeFileSync(
        path.join(artifacts, `${variant}.html`),
        actualRun.serverHtml ?? "",
      );
    }
    if (actualRun.removedWhileHydrating !== expectedRun.removedWhileHydrating) {
      report(
        variant,
        "hydration",
        `${actualRun.removedWhileHydrating} elements removed vs ${expectedRun.removedWhileHydrating}`,
      );
    }
    if (actualRun.messages.join("\n") !== expectedRun.messages.join("\n")) {
      report(
        variant,
        "console",
        `messages differ: ${JSON.stringify(actualRun.messages.slice(0, 3))} vs ${JSON.stringify(expectedRun.messages.slice(0, 3))}`,
      );
    }
  }

  for (const [i, step] of spec.steps.entries()) {
    const expected = expectedRun.captures[i];
    if (expected.error) {
      scriptErrors.push(
        `${example} ${reference} "${step.name}": ${expected.error}`,
      );
    }
    for (const variant of optimized) {
      const actual = (runs.get(variant) as Run).captures[i];
      const kinds = [
        actual.error !== expected.error &&
          `step ${actual.error ? `failed: ${actual.error}` : "succeeded only here"}`,
        actual.dom !== expected.dom && "DOM differs",
        !actual.png.equals(expected.png) && "pixels differ",
      ].filter(Boolean) as string[];
      if (kinds.length === 0) continue;
      report(variant, step.name, kinds.join(", "));
      const artifacts = path.join(
        OUT,
        example,
        `${String(i).padStart(2, "0")}-${step.name.replace(/\W+/g, "-")}`,
      );
      mkdirSync(artifacts, { recursive: true });
      for (const [name, capture] of [
        [reference, expected],
        [variant, actual],
      ] as const) {
        writeFileSync(path.join(artifacts, `${name}.png`), capture.png);
        writeFileSync(path.join(artifacts, `${name}.html`), capture.dom);
      }
    }
  }

  const failed = mismatches.filter((m) => m.example === example).length;
  const checks = spec.ssr ? ", prerendered HTML, hydration, console" : "";
  console.log(
    `${example}: ${spec.steps.length} steps × ${optimized.length} variants vs ${reference}${checks}: ${failed === 0 ? "identical" : `${failed} mismatches`}`,
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
