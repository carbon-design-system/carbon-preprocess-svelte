import { globSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { setComponents } from "./component-index-registry";
import { ensureLiveComponentIndex } from "./indexer/live-index";
import { createCssOptimizer } from "./plugins/create-optimized-css";
import { logAssetDiff } from "./plugins/print-diff";
import type { AssetReport } from "./plugins/print-report";
import { printReport, toAssetReport } from "./plugins/print-report";
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
  --preserve-all-ibm-fonts
                          Keep every IBM Plex @font-face rule.
  --live-index            Build the component index from the installed
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
  }

  const [subcommand, ...cssPatterns] = positionals;

  if (subcommand !== "optimize-css") {
    console.log(USAGE);
    process.exit(1);
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

  // Scan sources once for Carbon imports and literal `bx--` tokens, the
  // same allowlist inputs the plugins collect from bundler hooks.
  const components = new Set<string>();
  const contentClasses = new Set<string>();

  for (const file of globSync(contentGlobs, { cwd })) {
    let text: string;
    try {
      text = readFileSync(path.resolve(cwd, file), "utf-8");
    } catch {
      continue;
    }
    collectCarbonImports(text, components);
    collectCarbonTokens(text, contentClasses);
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

  if (values["live-index"]) {
    setComponents(await ensureLiveComponentIndex());
  }

  const safelist = parseSafelist(values.safelist ?? []);
  const dryRun = values["dry-run"] === true;
  const silent = values.silent === true;
  const optimizer = createCssOptimizer({
    ids: components,
    contentClasses,
    safelist,
    preserveAllIBMFonts: values["preserve-all-ibm-fonts"] === true,
  });
  const assetReports: AssetReport[] = [];

  for (const id of cssFiles) {
    const css = readFileSync(path.resolve(cwd, id), "utf-8");
    const { css: optimized, removed } = optimizer.run(css);

    if (!dryRun && removed > 0) {
      writeFileSync(path.resolve(cwd, id), optimized);
    }

    if (!silent && removed > 0) {
      logAssetDiff({ original_css: css, optimized_css: optimized, id, dryRun });
    }

    if (values.report) {
      assetReports.push(toAssetReport(id, css, optimized, removed));
    }
  }

  if (values.report) {
    printReport({
      components: optimizer.usage.components,
      allowlistSize: optimizer.usage.allowlistSize,
      moduleTokens: 0,
      contentTokens: contentClasses.size,
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
