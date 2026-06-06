import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { $ } from "bun";
import { name } from "../package.json";

const SNAPSHOT_PATH = join(import.meta.dirname, "__snapshots__/e2e.json");
const UPDATE_SNAPSHOTS = process.env.UPDATE_SNAPSHOTS === "true";

const OPTIMIZED_REGEX = /Optimized\s+(.+\.css)/;
const BEFORE_REGEX = /Before:\s*([\d,.]+)\s*(kB|MB)/;
const AFTER_REGEX = /After:\s*([\d,.]+)\s*(kB|MB)\s*\(-?([\d.]+)%\)/;
const DOUBLE_NEWLINE_REGEX = /\n\n+/;

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
};

function isOptimizationResult(
  value: ExampleSnapshot,
): value is OptimizationResult {
  return "file" in value;
}

function parseOptimizationOutput(output: string): OptimizationResult | null {
  const optimizedMatch = output.match(OPTIMIZED_REGEX);
  const beforeMatch = output.match(BEFORE_REGEX);
  const afterMatch = output.match(AFTER_REGEX);

  if (!optimizedMatch || !beforeMatch || !afterMatch) {
    return null;
  }

  const file = optimizedMatch[1];
  let before_kb = Number.parseFloat(beforeMatch[1].replace(",", ""));
  let after_kb = Number.parseFloat(afterMatch[1].replace(",", ""));
  const reduction_percent = Number.parseFloat(afterMatch[3]);

  if (beforeMatch[2] === "MB") {
    before_kb *= 1000;
  }
  if (afterMatch[2] === "MB") {
    after_kb *= 1000;
  }

  return { file, before_kb, after_kb, reduction_percent };
}

function normalizeFile(file: string): string {
  return file
    .replace(/\.[a-f0-9]{16,}\./g, ".*.")
    .replace(/-[A-Za-z0-9_-]{6,}\./g, "-*.")
    .replace(/\.[A-Za-z0-9_-]{6,}\./g, ".*.");
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

function saveSnapshots(snapshots: Snapshots): void {
  const dir = dirname(SNAPSHOT_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const sorted = Object.keys(snapshots)
    .sort()
    .reduce<Snapshots>((acc, key) => {
      acc[key] = sortSnapshotValue(snapshots[key]);
      return acc;
    }, {});
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
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

  const tolerance = 0.01;
  const beforeDiff = Math.abs(actual.before_kb - expected.before_kb);
  const afterDiff = Math.abs(actual.after_kb - expected.after_kb);
  const percentDiff = Math.abs(
    actual.reduction_percent - expected.reduction_percent,
  );

  if (
    beforeDiff > tolerance ||
    afterDiff > tolerance ||
    percentDiff > tolerance
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

function parseLastOptimizationBlock(output: string): OptimizationResult | null {
  const optimizationBlocks = output
    .split(DOUBLE_NEWLINE_REGEX)
    .filter(
      (block) => block.includes("Optimized") && block.includes("Before:"),
    );

  if (optimizationBlocks.length === 0) {
    return null;
  }

  return parseOptimizationOutput(
    optimizationBlocks[optimizationBlocks.length - 1],
  );
}

async function buildSingleEntry(
  dir: string,
  exampleName: string,
  snapshots: Snapshots,
  newSnapshots: Snapshots,
): Promise<BuildOutcome> {
  const buildResult = await $`cd ${dir} && bun run build`.text();
  console.log(buildResult);

  const parsed = parseLastOptimizationBlock(buildResult);
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
    // biome-ignore lint/performance/noAwaitInLoops: build entries sequentially to capture output correctly
    const buildResult = await $`cd ${dir} && bun run build:${entry}`.text();
    console.log(buildResult);

    const label = `${exampleName}/${entry}`;
    const parsed = parseLastOptimizationBlock(buildResult);

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
    if (dir) examples.push(dir);
  }

  for (const dir of examples) {
    // biome-ignore lint/performance/noAwaitInLoops: build examples sequentially to capture output correctly
    const outcomes = await buildExample(dir, snapshots, newSnapshots);
    results.push(...outcomes);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("CSS Optimization Snapshot Results");
  console.log("=".repeat(60));

  let allPassed = true;
  for (const result of results) {
    const status = result.passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    console.log(`${status} ${result.example}`);
    if (!result.passed || UPDATE_SNAPSHOTS) {
      console.log(`  ${result.message}`);
    }
    if (!result.passed) {
      allPassed = false;
    }
  }

  if (UPDATE_SNAPSHOTS) {
    saveSnapshots(newSnapshots);
    console.log(`\n\x1b[33mSnapshots updated: ${SNAPSHOT_PATH}\x1b[0m`);
  }

  console.log();

  if (!allPassed && !UPDATE_SNAPSHOTS) {
    process.exit(1);
  }
}

main();
