import { globSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { createCssOptimizer } from "./plugins/create-optimized-css";
import { optimizeCarbonCss } from "./plugins/optimize-carbon-css";
import { printDiff } from "./plugins/print-diff";
import type { AssetReport } from "./plugins/print-report";
import { printReport } from "./plugins/print-report";
import type { SafelistEntry } from "./plugins/safelist";
import { collectCarbonTokens } from "./plugins/scan-content";
import { collectCarbonImports } from "./plugins/scan-imports";

const REGEXP_SAFELIST_ENTRY = /^\/(.+)\/([a-z]*)$/;

const DEFAULT_CONTENT_GLOBS = ["src/**/*.{svelte,js,ts,mjs}"];

const USAGE = `Usage: carbon-preprocess-svelte optimize-css [options] <css-file-or-glob>...

Removes unused Carbon styles from built CSS files, in place.
Carbon components are detected from imports in the files matched by --content.

Options:
  --content <glob>        Source files to scan for Carbon imports and literal
                          bx-- classes. Repeatable. Default: src/**/*.{svelte,js,ts,mjs}
  --components <a,b,c>    Component names to keep in addition to detected ones.
  --safelist <selector>   Class selector to always keep. Repeatable. Wrap in
                          slashes for a RegExp: --safelist "/^\\.bx--btn--/"
  --preserve-all-ibm-fonts  Keep every IBM Plex @font-face rule.
  --live-index              Build the component index from the installed
                          carbon-components-svelte (experimental).
  --cwd <dir>             Directory globs resolve from. Default: process.cwd()
  --dry-run               Print sizes, write nothing.
  --report                Print detected components and allowlist summary.
  --silent                Suppress the per-file size log.
  -h, --help              Show this help.`;

function parseSafelist(entries: readonly string[]): SafelistEntry[] {
  return entries.map((entry) => {
    const match = entry.match(REGEXP_SAFELIST_ENTRY);
    return match ? new RegExp(match[1], match[2]) : entry;
  });
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      content: { type: "string", multiple: true },
      components: { type: "string" },
      safelist: { type: "string", multiple: true },
      "preserve-all-ibm-fonts": { type: "boolean" },
      "live-index": { type: "boolean" },
      cwd: { type: "string" },
      "dry-run": { type: "boolean" },
      report: { type: "boolean" },
      silent: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(USAGE);
    process.exit(0);
    return;
  }

  const [subcommand, ...cssPatterns] = positionals;

  if (subcommand === undefined || subcommand !== "optimize-css") {
    console.log(USAGE);
    process.exit(1);
    return;
  }

  const cwd = path.resolve(values.cwd ?? process.cwd());

  const cssFiles = [
    ...new Set(
      globSync(cssPatterns, { cwd }).filter((file) => file.endsWith(".css")),
    ),
  ].sort();

  if (cssFiles.length === 0) {
    throw new Error(`no CSS files matched ${JSON.stringify(cssPatterns)}`);
  }

  const contentGlobs =
    values.content && values.content.length > 0
      ? values.content
      : DEFAULT_CONTENT_GLOBS;

  const contentFiles = globSync(contentGlobs, { cwd });
  const components = new Set<string>();
  const contentTexts: string[] = [];

  for (const file of contentFiles) {
    let text: string;
    try {
      text = readFileSync(path.resolve(cwd, file), "utf-8");
    } catch {
      continue;
    }
    contentTexts.push(text);
    collectCarbonImports(text, components);
  }

  for (const name of (values.components ?? "").split(",")) {
    const trimmed = name.trim();
    if (trimmed) components.add(trimmed);
  }

  if (components.size === 0) {
    throw new Error(
      `no carbon-components-svelte imports found in ${JSON.stringify(contentGlobs)}; pass --components or fix --content`,
    );
  }

  const safelist = parseSafelist(values.safelist ?? []);
  const dryRun = values["dry-run"] === true;
  const silent = values.silent === true;

  const results = await Promise.all(
    cssFiles.map(async (id) => {
      const css = readFileSync(path.resolve(cwd, id), "utf-8");
      const { css: optimized, removed } = await optimizeCarbonCss(css, {
        components,
        sources: contentTexts,
        safelist,
        preserveAllIBMFonts: values["preserve-all-ibm-fonts"] === true,
        experimental: { liveIndex: values["live-index"] === true },
      });
      return { id, css, optimized, removed };
    }),
  );

  const assetReports: AssetReport[] = [];

  for (const { id, css, optimized, removed } of results) {
    if (!dryRun && removed > 0) {
      writeFileSync(path.resolve(cwd, id), optimized);
    }

    if (!silent && removed > 0) {
      if (dryRun) {
        console.log(`Dry run: ${id} left unchanged`);
      }
      printDiff({ original_css: css, optimized_css: optimized, id });
    }

    if (values.report) {
      assetReports.push({
        id,
        removed,
        beforeBytes: Buffer.byteLength(css),
        afterBytes: Buffer.byteLength(optimized),
      });
    }
  }

  if (values.report) {
    const moduleClasses = new Set<string>();
    for (const text of contentTexts) {
      collectCarbonTokens(text, moduleClasses);
    }

    const optimizer = createCssOptimizer({
      ids: components,
      contentClasses: moduleClasses,
      safelist,
      preserveAllIBMFonts: values["preserve-all-ibm-fonts"] === true,
    });

    printReport({
      components: optimizer.usage.components,
      allowlistSize: optimizer.usage.allowlistSize,
      moduleTokens: moduleClasses.size,
      contentTokens: 0,
      safelistEntries: safelist.length,
      assets: assetReports,
      dryRun,
    });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`carbon-preprocess-svelte: ${message}`);
  process.exit(1);
});
