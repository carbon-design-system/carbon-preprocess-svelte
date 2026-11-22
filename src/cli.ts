import { globSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { CARBON, CSS_FAILURE } from "./carbon-library";
import { LOG_PREFIX } from "./constants";
import { resolveCarbonRoot } from "./indexer/resolve-carbon-root";
import {
  collectedEngine,
  createCssOptimizer,
} from "./plugins/create-optimized-css";
import { tokenNamesFile } from "./plugins/token-names";
import { optimizeAssets } from "./plugins/optimize-assets";
import { usageOptions } from "./plugins/options";
import type { SafelistEntry } from "./plugins/safelist";
import { collectCarbonTokens, readFiles } from "./plugins/scan-content";
import { collectCarbonImports } from "./plugins/scan-imports";
import { version } from "../package.json" with { type: "json" };
import { errorMessage, isCssFile } from "./utils";

const REGEXP_SAFELIST_ENTRY = /^\/(.+)\/([a-z]*)$/;

const DEFAULT_CONTENT_GLOBS = ["src/**/*.{svelte,js,ts,mjs}"];

const USAGE = `Usage: carbon-preprocess-svelte optimize-css [options] <css-file-or-glob>...

Removes unused Carbon styles from built CSS files, in place.
Carbon components are detected from imports in the files matched by --content,
and their styles pruned by the props those files pass: --content must cover
every file that renders Carbon components.

Options:
  --content <glob>        Source files to scan for Carbon imports and literal
                          bx-- classes. Repeatable. Default: src/**/*.{svelte,js,ts,mjs}
  --components <a,b,c>    Component names to keep in addition to detected ones.
  --safelist <selector>   Class selector to always keep. Repeatable. Wrap in
                          slashes for a RegExp: --safelist "/^\\.bx--btn--/"
  --preserve-all-ibm-fonts
                          Keep every IBM Plex @font-face rule.
  --exclude <a,b,c>       Components that keep every variant's styles, as if
                          rendered with any props.
  --cwd <dir>             Project directory; globs and carbon-components-svelte
                          resolve from it. Default: process.cwd()
  --dry-run               Print sizes, write nothing.
  --report                Print the components that can render, and what was kept.
  --silent                Suppress the per-file size log.
  --json                  Print the result as one JSON object on stdout, and
                          an error as JSON too. Not with --report.
  -v, --version           Print the version.
  -h, --help              Show this help.

Exit status: 0 when done; 2 when called wrong, when there's nothing to
prune (no CSS file matched, no Carbon import found), or when the analysis
of the --content files fails, which leaves every file unchanged.

For agents and scripts: pass --json and read stdout. A run prints
{ schemaVersion, ok: true, dryRun, summary: { files, pruned, before, after },
files: [{ file, before, after, removed }] }, sizes in bytes; an exit 2 prints
{ schemaVersion, ok: false, error: { kind, message } }, where kind is usage,
input or failure.`;

const SCHEMA_VERSION = 1;

// Why a run exited 2, as --json names it.
type ErrorKind = "usage" | "input" | "failure";

class CliError extends Error {
  readonly kind: ErrorKind;
  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

const OPTIONS = {
  content: { type: "string", multiple: true },
  components: { type: "string" },
  safelist: { type: "string", multiple: true },
  "preserve-all-ibm-fonts": { type: "boolean" },
  exclude: { type: "string" },
  cwd: { type: "string" },
  "dry-run": { type: "boolean" },
  report: { type: "boolean" },
  silent: { type: "boolean" },
  json: { type: "boolean" },
  version: { type: "boolean", short: "v" },
  help: { type: "boolean", short: "h" },
} as const;

const UNKNOWN_OPTION = /Unknown option '(-{1,2}[^'=]+)/;
const LEADING_DASHES = /^-+/;

// Edit distance, for suggesting the flag a typo meant.
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(
        (row[j] ?? 0) + 1,
        (next[j - 1] ?? 0) + 1,
        (row[j - 1] ?? 0) + cost,
      );
    }
    row = next;
  }
  return row[b.length] ?? 0;
}

function unknownOption(error: unknown): CliError {
  const flag = UNKNOWN_OPTION.exec(errorMessage(error))?.[1];
  if (!flag) return new CliError("usage", errorMessage(error));
  const name = flag.replace(LEADING_DASHES, "");
  const closest = Object.keys(OPTIONS)
    .map((option) => ({ option, d: distance(name, option) }))
    .filter(({ d }) => d <= 2)
    .sort((x, y) => x.d - y.d)[0];
  const hint = closest ? ` Did you mean --${closest.option}?` : "";
  return new CliError(
    "usage",
    `unknown option ${flag}.${hint} Run with --help for the options.`,
  );
}

/** `a, b,c` as `["a", "b", "c"]`. */
function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function parseSafelist(entries: readonly string[]): SafelistEntry[] {
  return entries.map((entry) => {
    const match = entry.match(REGEXP_SAFELIST_ENTRY);
    return match ? new RegExp(match[1], match[2]) : entry;
  });
}

function parse(args: string[]) {
  if (args.includes("--prop-aware")) {
    throw new CliError(
      "usage",
      "--prop-aware was removed in 0.14.0: CSS is always pruned by the props the --content files pass. Drop it, and pass --exclude DataTable for a component that should keep every variant.",
    );
  }
  try {
    return parseArgs({ args, allowPositionals: true, options: OPTIONS });
  } catch (error) {
    throw unknownOption(error);
  }
}

async function main() {
  const { values, positionals } = parse(process.argv.slice(2));

  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (values.version) {
    console.log(version);
    return;
  }

  const [subcommand, ...cssPatterns] = positionals;

  if (subcommand !== "optimize-css") {
    throw new CliError(
      "usage",
      subcommand
        ? `unknown command ${JSON.stringify(subcommand)}; the one command is optimize-css.`
        : "no command given; the one command is optimize-css.",
    );
  }
  const json = values.json === true;
  if (json && values.report) {
    throw new CliError(
      "usage",
      "--report prints text, so it can't go with --json.",
    );
  }

  const cwd = path.resolve(values.cwd ?? process.cwd());

  const cssFiles = [
    ...new Set(globSync(cssPatterns, { cwd }).filter(isCssFile)),
  ].sort();

  if (cssFiles.length === 0) {
    throw new CliError(
      "input",
      `no CSS files matched ${JSON.stringify(cssPatterns)}`,
    );
  }

  const contentGlobs =
    values.content && values.content.length > 0
      ? values.content
      : DEFAULT_CONTENT_GLOBS;

  const components = new Set<string>();
  const contentClasses = new Set<string>();
  const sources: Array<{ file: string; code: string }> = [];
  /** Some file may use components it doesn't name (`import * as C`). */
  let usesAll = false;

  for (const source of readFiles(globSync(contentGlobs, { cwd }), cwd)) {
    usesAll = collectCarbonImports(source.code, components) || usesAll;
    collectCarbonTokens(source.code, contentClasses);
    sources.push(source);
  }

  for (const name of parseList(values.components)) components.add(name);

  if (components.size === 0 && !usesAll) {
    throw new CliError(
      "input",
      `no carbon-components-svelte imports found in ${JSON.stringify(contentGlobs)}; pass --components or fix --content`,
    );
  }

  const analyzer = await import("svelte-prune/internal/analysis");
  if (usesAll) {
    const carbon = analyzer.libraryAt(CARBON, resolveCarbonRoot(cwd));
    for (const name of carbon.components.keys()) components.add(name);
  }

  const safelist = parseSafelist(values.safelist ?? []);
  const options = {
    safelist,
    preserveAllIBMFonts: values["preserve-all-ibm-fonts"] === true,
    dryRun: values["dry-run"] === true,
    report: values.report === true,
    silent: values.silent === true || json,
  };

  const usage = await analyzer.analyzeFiles({
    library: CARBON,
    failure: CSS_FAILURE,
    projectRoot: cwd,
    files: sources,
    components,
    options: usageOptions({ exclude: parseList(values.exclude) }),
  });
  // Without the analysis, nothing says which styles the app renders, so
  // the files stay as they are.
  if ("warning" in usage) throw new CliError("failure", usage.warning);
  // The CLI sees no build output, so every token stays.
  const engine = collectedEngine(usage, analyzer, cwd, [
    ...sources,
    tokenNamesFile(["--cds-"]),
  ]);

  const optimizer = createCssOptimizer({
    ...options,
    contentClasses,
    analysis: usage,
    engine,
  });

  const files: Array<{
    file: string;
    before: number;
    after: number;
    removed: number;
  }> = [];
  optimizeAssets({
    assets: cssFiles.map((id) => {
      const file = path.resolve(cwd, id);
      const source = readFileSync(file, "utf-8");
      return {
        id,
        source,
        write(css) {
          writeFileSync(file, css);
        },
      };
    }),
    optimizer,
    options,
    contentTokens: contentClasses.size,
    onAsset: ({ id, ...sizes }) => files.push({ file: id, ...sizes }),
    reportExtra: () =>
      analyzer.formatPropAwareReport(usage, optimizer.usage.prunedByProps, cwd),
  });

  if (json) {
    const result = {
      schemaVersion: SCHEMA_VERSION,
      ok: true,
      dryRun: options.dryRun,
      summary: {
        files: files.length,
        pruned: files.filter(({ removed }) => removed > 0).length,
        before: files.reduce((sum, { before }) => sum + before, 0),
        after: files.reduce((sum, { after }) => sum + after, 0),
      },
      files,
    };
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error: unknown) => {
  const kind = error instanceof CliError ? error.kind : "failure";
  const message = errorMessage(error);
  if (process.argv.includes("--json")) {
    const failure = {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      error: { kind, message },
    };
    console.log(JSON.stringify(failure, null, 2));
  } else console.error(`${LOG_PREFIX} ${message}`);
  process.exitCode = 2;
});
