// Builds every example against the build in `dist/`.
// @depends-on scripts/build.ts
// @reads examples/** tests/__snapshots__/e2e.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { $ } from "bun";
import { name } from "../package.json";

const SNAPSHOT_PATH = join(import.meta.dirname, "__snapshots__/e2e.json");
const UPDATE_SNAPSHOTS = process.env.UPDATE_SNAPSHOTS === "true";
/**
 * Where to write the snapshots this run observed, matching or not (CI
 * uploads it; `bun run snapshots:from-ci` applies it).
 */
const OBSERVED_PATH = process.env.E2E_OBSERVED;
/** Comma-separated example names to build (`vite,vite@svelte-5`); all by default. */
const ONLY_EXAMPLES = process.env.EXAMPLES?.split(",").filter(Boolean);

/** A stylesheet's row in the pruning summary: `  <file>  <before> kB  →  <after> kB  -<percent>%` */
const SIZE_ROW_REGEX =
  /^ {2}(\S+\.css)\s+([\d,]+\.\d) kB {2}→\s+([\d,]+\.\d) kB {2}-(\d+)%$/;
// Preprocessor/index loader prefix, then the plugins' prefix.
const WARNING_REGEX = /\[carbon-preprocess-svelte\]|carbon-preprocess-svelte:/;
/** The summary's header shares the prefix, but isn't a warning. */
const SUMMARY_HEADER_REGEX =
  /carbon-preprocess-svelte: (?:rewrote \d+ Carbon components?|pruned Carbon CSS|dry run, files unchanged|nothing to prune)/;
/** The summary's sizes are rounded to 0.1 kB and whole percentages. */
const SIZE_TOLERANCE_KB = 0.1;
const PERCENT_TOLERANCE = 1;

type OptimizationResult = {
  file: string;
  before_kb: number;
  after_kb: number;
  reduction_percent: number;
};

type ExampleSnapshot = OptimizationResult | Record<string, OptimizationResult>;

type Snapshots = Record<string, ExampleSnapshot>;

type BuildOutcome = {
  example: string;
  passed: boolean;
  message: string;
  /** Failed on a warning, which a snapshot update can't fix. */
  warned?: boolean;
};

type BuildRun = {
  stdout: string;
  warnings: string[];
};

/** Runs a package script. Not `.text()`: it drops stderr, where warnings land. */
async function runBuild(dir: string, script: string): Promise<BuildRun> {
  const result = await $`cd ${dir} && bun run ${script}`.nothrow().quiet();
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  console.log(stdout);
  if (stderr) console.error(stderr);

  if (result.exitCode !== 0) {
    throw new Error(
      `"bun run ${script}" failed in ${dir} (exit ${result.exitCode})`,
    );
  }

  const warnings = `${stdout}\n${stderr}`
    .split("\n")
    .map((line) => stripVTControlCharacters(line))
    .filter(
      (line) => WARNING_REGEX.test(line) && !SUMMARY_HEADER_REGEX.test(line),
    )
    .map((line) => line.trim());

  return { stdout, warnings };
}

/**
 * Any warning fails the build: size snapshots miss some degraded builds
 * (webpack and Rspack prune the same CSS whether or not imports were rewritten).
 */
function warningOutcome(
  label: string,
  warnings: string[],
): BuildOutcome | undefined {
  if (warnings.length === 0) return undefined;
  return {
    example: label,
    passed: false,
    message: `Build emitted carbon-preprocess-svelte warnings:\n  ${warnings.join("\n  ")}`,
    warned: true,
  };
}

function isOptimizationResult(
  value: ExampleSnapshot,
): value is OptimizationResult {
  return "file" in value;
}

function parseOptimizationOutput(row: string): OptimizationResult | null {
  const match = row.match(SIZE_ROW_REGEX);
  if (!match) return null;

  const [, file, before, after, percent] = match;
  return {
    file,
    before_kb: Number.parseFloat(before.replaceAll(",", "")),
    after_kb: Number.parseFloat(after.replaceAll(",", "")),
    reduction_percent: Number.parseFloat(percent),
  };
}

function normalizeFile(file: string): string {
  return file
    .replace(/\.[a-f0-9]{16,}\./g, ".*.")
    .replace(/\.[A-Za-z0-9_-]{6,}\./g, ".*.")
    .replace(/-[A-Za-z0-9_-]{6,}\./g, "-*.");
}

function normalizeResult(parsed: OptimizationResult): OptimizationResult {
  return {
    file: normalizeFile(parsed.file),
    before_kb: parsed.before_kb,
    after_kb: parsed.after_kb,
    reduction_percent: parsed.reduction_percent,
  };
}

function loadSnapshots(): Snapshots {
  if (!existsSync(SNAPSHOT_PATH)) {
    return {};
  }
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf-8"));
}

function sortSnapshotValue(value: ExampleSnapshot): ExampleSnapshot {
  if (!("file" in value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, value[key]]),
    );
  }
  return value;
}

function saveSnapshots(snapshots: Snapshots, path = SNAPSHOT_PATH): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const sorted = Object.keys(snapshots)
    .sort()
    .reduce<Snapshots>((acc, key) => {
      acc[key] = sortSnapshotValue(snapshots[key]);
      return acc;
    }, {});
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`);
}

function loadEntryManifest(dir: string): string[] | null {
  const manifestPath = join(dir, "entries.manifest.json");
  if (!existsSync(manifestPath)) {
    return null;
  }
  return JSON.parse(readFileSync(manifestPath, "utf-8")) as string[];
}

function compareResults(
  label: string,
  actual: OptimizationResult,
  expected: OptimizationResult | undefined,
): BuildOutcome {
  if (!expected) {
    return {
      example: label,
      passed: false,
      message: `No snapshot found for "${label}". Run with UPDATE_SNAPSHOTS=true to create.`,
    };
  }

  const normalizedActual = normalizeFile(actual.file);
  const normalizedExpected = expected.file;

  if (normalizedActual !== normalizedExpected) {
    return {
      example: label,
      passed: false,
      message: `File pattern mismatch for "${label}":\n  Expected: ${normalizedExpected}\n  Actual:   ${normalizedActual}`,
    };
  }

  const beforeDiff = Math.abs(actual.before_kb - expected.before_kb);
  const afterDiff = Math.abs(actual.after_kb - expected.after_kb);
  const percentDiff = Math.abs(
    actual.reduction_percent - expected.reduction_percent,
  );

  if (
    beforeDiff > SIZE_TOLERANCE_KB ||
    afterDiff > SIZE_TOLERANCE_KB ||
    percentDiff > PERCENT_TOLERANCE
  ) {
    return {
      example: label,
      passed: false,
      message: `CSS optimization mismatch for "${label}":
  Before: ${expected.before_kb} kB -> ${actual.before_kb} kB (diff: ${beforeDiff.toFixed(2)})
  After:  ${expected.after_kb} kB -> ${actual.after_kb} kB (diff: ${afterDiff.toFixed(2)})
  Reduction: ${expected.reduction_percent}% -> ${actual.reduction_percent}% (diff: ${percentDiff.toFixed(2)})
Run with UPDATE_SNAPSHOTS=true to update.`,
    };
  }

  return { example: label, passed: true, message: "OK" };
}

/**
 * The summary's row for the snapshot's file, or for the build's largest
 * stylesheet when there's no snapshot or its file isn't in the summary.
 */
function parseLastOptimizationBlock(
  output: string,
  expectedFile?: string,
): OptimizationResult | null {
  const rows = stripVTControlCharacters(output)
    .split("\n")
    .map((line) => parseOptimizationOutput(line))
    .filter((row): row is OptimizationResult => row !== null);
  if (rows.length === 0) return null;
  const expected = rows.find((row) => normalizeFile(row.file) === expectedFile);
  return (
    expected ??
    rows.reduce((largest, row) =>
      row.before_kb > largest.before_kb ? row : largest,
    )
  );
}

async function buildSingleEntry(
  dir: string,
  exampleName: string,
  snapshots: Snapshots,
  newSnapshots: Snapshots,
): Promise<BuildOutcome> {
  const { stdout, warnings } = await runBuild(dir, "build");

  const warned = warningOutcome(exampleName, warnings);
  if (warned) return warned;

  const expectedFile = snapshots[exampleName];
  const parsed = parseLastOptimizationBlock(
    stdout,
    expectedFile && isOptimizationResult(expectedFile)
      ? expectedFile.file
      : undefined,
  );
  if (!parsed) {
    return {
      example: exampleName,
      passed: false,
      message: "No CSS optimization output found",
    };
  }

  const normalizedResult = normalizeResult(parsed);
  newSnapshots[exampleName] = normalizedResult;

  if (UPDATE_SNAPSHOTS) {
    return {
      example: exampleName,
      passed: true,
      message: `Updated: ${normalizedResult.before_kb} kB -> ${normalizedResult.after_kb} kB (-${normalizedResult.reduction_percent}%)`,
    };
  }

  const expected = snapshots[exampleName];
  if (!expected || !isOptimizationResult(expected)) {
    return compareResults(exampleName, parsed, undefined);
  }

  return compareResults(exampleName, parsed, expected);
}

async function buildMultiEntry(
  dir: string,
  exampleName: string,
  entries: string[],
  snapshots: Snapshots,
  newSnapshots: Snapshots,
): Promise<BuildOutcome[]> {
  const entrySnapshots: Record<string, OptimizationResult> = {};
  const outcomes: BuildOutcome[] = [];
  const expectedExample = snapshots[exampleName];
  const expectedEntries =
    expectedExample && !isOptimizationResult(expectedExample)
      ? expectedExample
      : undefined;

  for (const entry of entries) {
    console.log(`\n--- entry: ${entry} ---\n`);
    const { stdout, warnings } = await runBuild(dir, `build:${entry}`);

    const label = `${exampleName}/${entry}`;

    const warned = warningOutcome(label, warnings);
    if (warned) {
      outcomes.push(warned);
      continue;
    }

    const parsed = parseLastOptimizationBlock(
      stdout,
      expectedEntries?.[entry]?.file,
    );

    if (!parsed) {
      outcomes.push({
        example: label,
        passed: false,
        message: "No CSS optimization output found",
      });
      continue;
    }

    const normalizedResult = normalizeResult(parsed);
    entrySnapshots[entry] = normalizedResult;

    if (UPDATE_SNAPSHOTS) {
      outcomes.push({
        example: label,
        passed: true,
        message: `Updated: ${normalizedResult.before_kb} kB -> ${normalizedResult.after_kb} kB (-${normalizedResult.reduction_percent}%)`,
      });
      continue;
    }

    outcomes.push(compareResults(label, parsed, expectedEntries?.[entry]));
  }

  newSnapshots[exampleName] = entrySnapshots;
  return outcomes;
}

async function buildExample(
  dir: string,
  snapshots: Snapshots,
  newSnapshots: Snapshots,
): Promise<BuildOutcome[]> {
  const exampleName = dir.replace("examples/", "");
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Building: ${exampleName}`);
  console.log("=".repeat(60));

  await $`cd ${dir} && bun link ${name} && bun install`;
  // The index cache is keyed by package versions, which don't change
  // between local edits to the indexer, so a stale one would mask them.
  await $`rm -rf ${join(dir, "node_modules/.cache/carbon-preprocess-svelte")}`;

  const entries = loadEntryManifest(dir);
  if (entries) {
    return buildMultiEntry(dir, exampleName, entries, snapshots, newSnapshots);
  }

  const outcome = await buildSingleEntry(
    dir,
    exampleName,
    snapshots,
    newSnapshots,
  );
  return [outcome];
}

async function main() {
  console.log("Building and linking package...\n");
  await $`bun run build && bun link`;

  const snapshots = loadSnapshots();
  const newSnapshots: Snapshots = {};
  const results: BuildOutcome[] = [];

  const examples: string[] = [];
  for await (const dir of $`find examples -maxdepth 1 -mindepth 1 -type d`.lines()) {
    if (!dir) continue;
    if (
      ONLY_EXAMPLES &&
      !ONLY_EXAMPLES.includes(dir.replace("examples/", ""))
    ) {
      continue;
    }
    examples.push(dir);
  }

  for (const dir of examples) {
    const outcomes = await buildExample(dir, snapshots, newSnapshots);
    results.push(...outcomes);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("CSS Optimization Snapshot Results");
  console.log("=".repeat(60));

  let allPassed = true;
  let anyWarned = false;
  for (const result of results) {
    const status = result.passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    console.log(`${status} ${result.example}`);
    if (!result.passed || UPDATE_SNAPSHOTS) {
      console.log(`  ${result.message}`);
    }
    if (!result.passed) {
      allPassed = false;
    }
    if (result.warned) {
      anyWarned = true;
    }
  }

  // A warned build recorded no result, so saving would drop its snapshot.
  if (UPDATE_SNAPSHOTS && anyWarned) {
    console.log(
      "\n\x1b[31mSnapshots not updated: fix the warnings first.\x1b[0m",
    );
  } else if (UPDATE_SNAPSHOTS) {
    // A filtered run only rebuilt some examples; keep the others' snapshots.
    saveSnapshots(
      ONLY_EXAMPLES ? { ...snapshots, ...newSnapshots } : newSnapshots,
    );
    console.log(`\n\x1b[33mSnapshots updated: ${SNAPSHOT_PATH}\x1b[0m`);
  }

  // What a snapshot update would write, for CI to hand back; a warned
  // build has no result to record.
  if (OBSERVED_PATH && !anyWarned) {
    saveSnapshots({ ...snapshots, ...newSnapshots }, OBSERVED_PATH);
    console.log(`\nObserved snapshots: ${OBSERVED_PATH}`);
  }

  console.log();

  if (anyWarned || (!allPassed && !UPDATE_SNAPSHOTS)) {
    process.exit(1);
  }
}

main();
