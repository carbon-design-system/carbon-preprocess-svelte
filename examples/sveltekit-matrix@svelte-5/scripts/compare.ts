/**
 * Builds every variant (see `vite.config.ts`) and prints their CSS and JS
 * sizes side by side, minified and gzipped, against `baseline`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { $ } from "bun";

const VARIANTS = ["baseline", "css", "prop-aware", "full"];
const dir = join(import.meta.dirname, "..");

type Sizes = { css: number; cssGzip: number; js: number; jsGzip: number };

/** Every file under `root`, recursively. */
function files(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((file) => join(root, file))
    .filter((file) => statSync(file).isFile());
}

function measure(variant: string): Sizes {
  // The client assets SvelteKit emits; the prerendered HTML isn't counted.
  const assets = join(dir, "build", variant, "_app", "immutable");
  const sizes: Sizes = { css: 0, cssGzip: 0, js: 0, jsGzip: 0 };
  for (const file of files(assets)) {
    const bytes = readFileSync(file);
    const gzip = gzipSync(bytes).length;
    if (file.endsWith(".css")) {
      sizes.css += bytes.length;
      sizes.cssGzip += gzip;
    } else if (file.endsWith(".js")) {
      sizes.js += bytes.length;
      sizes.jsGzip += gzip;
    }
  }
  return sizes;
}

const results = new Map<string, Sizes>();
for (const variant of VARIANTS) {
  console.log(`\nBuilding ${variant}\n`);
  // biome-ignore lint/performance/noAwaitInLoops: sequential builds keep logs readable
  await $`cd ${dir} && VARIANT=${variant} vite build`;
  results.set(variant, measure(variant));
}

const kb = (bytes: number) => `${(bytes / 1000).toFixed(2)} kB`;
const baseline = results.get("baseline") as Sizes;
const cell = (value: number, base: number) =>
  value === base
    ? kb(value)
    : `${kb(value)} (${(((value - base) / base) * 100).toFixed(1)}%)`;

const rows = [
  "| Variant | CSS | CSS gzip | JS | JS gzip |",
  "| --- | --- | --- | --- | --- |",
  ...VARIANTS.map((variant) => {
    const s = results.get(variant) as Sizes;
    return `| ${variant} | ${cell(s.css, baseline.css)} | ${cell(s.cssGzip, baseline.cssGzip)} | ${cell(s.js, baseline.js)} | ${cell(s.jsGzip, baseline.jsGzip)} |`;
  }),
];
console.log(`\n${rows.join("\n")}\n`);
