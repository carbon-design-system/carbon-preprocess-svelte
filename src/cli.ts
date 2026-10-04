import { globSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { PropAwareResult } from "./analyzer";
import { LOG_PREFIX } from "./constants";
import { loadComponentIndex } from "./indexer/load-index";
import { createCssOptimizer } from "./plugins/create-optimized-css";
import { optimizeAssets } from "./plugins/optimize-assets";
import type { SafelistEntry } from "./plugins/safelist";
import { collectCarbonTokens, readFiles } from "./plugins/scan-content";
import { collectCarbonImports } from "./plugins/scan-imports";
import { isCssFile } from "./utils";

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
  --experimental-prop-aware
                          Also prune styles for prop values, slots, and child
                          components the --content files never use.
  --cwd <dir>             Project directory; globs and carbon-components-svelte
                          resolve from it. Default: process.cwd()
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
      "experimental-prop-aware": { type: "boolean" },
      cwd: { type: "string" },
      "dry-run": { type: "boolean" },
      report: { type: "boolean" },
      silent: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }

  const [subcommand, ...cssPatterns] = positionals;

  if (subcommand !== "optimize-css") {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const cwd = path.resolve(values.cwd ?? process.cwd());

  const cssFiles = [
    ...new Set(globSync(cssPatterns, { cwd }).filter(isCssFile)),
  ].sort();

  if (cssFiles.length === 0) {
    throw new Error(`no CSS files matched ${JSON.stringify(cssPatterns)}`);
  }

  const contentGlobs =
    values.content && values.content.length > 0
      ? values.content
      : DEFAULT_CONTENT_GLOBS;

  const components = new Set<string>();
  const contentClasses = new Set<string>();
  const propAware = values["experimental-prop-aware"] === true;
  const sources: Array<{ file: string; code: string }> = [];

  for (const source of readFiles(globSync(contentGlobs, { cwd }), cwd)) {
    collectCarbonImports(source.code, components);
    collectCarbonTokens(source.code, contentClasses);
    if (propAware) sources.push(source);
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

  const index = await loadComponentIndex(cwd);
  // `loadComponentIndex` already warned; the files stay unpruned.
  if (!index) {
    process.exitCode = 1;
    return;
  }

  const safelist = parseSafelist(values.safelist ?? []);
  const options = {
    safelist,
    preserveAllIBMFonts: values["preserve-all-ibm-fonts"] === true,
    dryRun: values["dry-run"] === true,
    report: values.report === true,
    silent: values.silent === true,
  };

  const analyzer = propAware ? await import("./analyzer") : undefined;
  let usage: PropAwareResult | undefined;
  if (analyzer) {
    const result = await analyzer.analyzeFiles({
      projectRoot: cwd,
      files: sources,
      components,
      options: {},
    });
    if ("warning" in result) console.warn(result.warning);
    else usage = result;
  }

  const optimizer = createCssOptimizer({
    ...options,
    components: index,
    ids: components,
    contentClasses,
    propAware: usage,
  });

  optimizeAssets({
    assets: cssFiles.map((id) => {
      const file = path.resolve(cwd, id);
      const source = readFileSync(file, "utf-8");
      return {
        id,
        source,
        write(css) {
          if (css !== source) writeFileSync(file, css);
        },
      };
    }),
    optimizer,
    options,
    contentTokens: contentClasses.size,
    reportExtra: () =>
      analyzer && usage
        ? analyzer.formatPropAwareReport(
            usage,
            optimizer.usage.prunedByProps,
            cwd,
          )
        : [],
  });
}

main().catch((error) => {
  console.error(
    `${LOG_PREFIX} ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
});
