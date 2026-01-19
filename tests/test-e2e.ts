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

type Snapshots = Record<string, OptimizationResult>;

function parseOptimizationOutput(output: string): OptimizationResult | null {
  // Match patterns like:
  // Optimized build/bundle.2d903152c49d244a9e80.css
  // Before: 616.43 kB
  // After:  158.03 kB (-74.36%)
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

  // Convert MB to kB if needed
  if (beforeMatch[2] === "MB") {
    before_kb *= 1000;
  }
  if (afterMatch[2] === "MB") {
    after_kb *= 1000;
  }

  return { file, before_kb, after_kb, reduction_percent };
}

function normalizeFile(file: string): string {
  // Replace hash patterns with wildcards for comparison
  // e.g., "bundle.2d903152c49d244a9e80.css" -> "bundle.*.css"
  // e.g., "index-Dy4ZbPK8.css" -> "index-*.css"
  // e.g., "2.Dy4ZbPK8.css" -> "*.*.css" (SvelteKit client build)
  // e.g., "_page.Dt0_NptM.css" -> "_page.*.css"
  return file
    .replace(/\.[a-f0-9]{16,}\./g, ".*.")
    .replace(/-[A-Za-z0-9_-]{6,}\./g, "-*.")
    .replace(/\.[A-Za-z0-9_-]{6,}\./g, ".*.");
}

function loadSnapshots(): Snapshots {
  if (!existsSync(SNAPSHOT_PATH)) {
    return {};
  }
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf-8"));
}

function saveSnapshots(snapshots: Snapshots): void {
  const dir = dirname(SNAPSHOT_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const sorted = Object.keys(snapshots)
    .sort()
    .reduce<Snapshots>((acc, key) => {
      acc[key] = snapshots[key];
      return acc;
    }, {});
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
}

function compareResults(
  example: string,
  actual: OptimizationResult,
  expected: OptimizationResult | undefined,
): { passed: boolean; message: string } {
  if (!expected) {
    return {
      passed: false,
      message: `No snapshot found for "${example}". Run with UPDATE_SNAPSHOTS=true to create.`,
    };
  }

  const normalizedActual = normalizeFile(actual.file);
  const normalizedExpected = expected.file;

  // Check if file pattern matches
  if (normalizedActual !== normalizedExpected) {
    return {
      passed: false,
      message: `File pattern mismatch for "${example}":\n  Expected: ${normalizedExpected}\n  Actual:   ${normalizedActual}`,
    };
  }

  // Allow small floating point tolerance (0.01 kB)
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
      passed: false,
      message: `CSS optimization mismatch for "${example}":
  Before: ${expected.before_kb} kB -> ${actual.before_kb} kB (diff: ${beforeDiff.toFixed(2)})
  After:  ${expected.after_kb} kB -> ${actual.after_kb} kB (diff: ${afterDiff.toFixed(2)})
  Reduction: ${expected.reduction_percent}% -> ${actual.reduction_percent}% (diff: ${percentDiff.toFixed(2)})
Run with UPDATE_SNAPSHOTS=true to update.`,
    };
  }

  return { passed: true, message: "OK" };
}

async function buildExample(
  dir: string,
  snapshots: Snapshots,
  newSnapshots: Snapshots,
): Promise<{ example: string; passed: boolean; message: string }> {
  const exampleName = dir.replace("examples/", "");
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Building: ${exampleName}`);
  console.log("=".repeat(60));

  await $`cd ${dir} && bun link ${name} && bun install`;

  const buildResult = await $`cd ${dir} && bun run build`.text();
  console.log(buildResult);

  const optimizationBlocks = buildResult
    .split(DOUBLE_NEWLINE_REGEX)
    .filter(
      (block) => block.includes("Optimized") && block.includes("Before:"),
    );

  if (optimizationBlocks.length === 0) {
    return {
      example: exampleName,
      passed: false,
      message: "No CSS optimization output found",
    };
  }

  const lastBlock = optimizationBlocks[optimizationBlocks.length - 1];
  const parsed = parseOptimizationOutput(lastBlock);

  if (!parsed) {
    return {
      example: exampleName,
      passed: false,
      message: "Failed to parse CSS optimization output",
    };
  }

  const normalizedResult: OptimizationResult = {
    file: normalizeFile(parsed.file),
    before_kb: parsed.before_kb,
    after_kb: parsed.after_kb,
    reduction_percent: parsed.reduction_percent,
  };
  newSnapshots[exampleName] = normalizedResult;

  if (UPDATE_SNAPSHOTS) {
    return {
      example: exampleName,
      passed: true,
      message: `Updated: ${normalizedResult.before_kb} kB -> ${normalizedResult.after_kb} kB (-${normalizedResult.reduction_percent}%)`,
    };
  }

  const comparison = compareResults(
    exampleName,
    parsed,
    snapshots[exampleName],
  );
  return { example: exampleName, ...comparison };
}

async function main() {
  console.log("Building and linking package...\n");
  await $`bun run build && bun link`;

  const snapshots = loadSnapshots();
  const newSnapshots: Snapshots = {};
  const results: { example: string; passed: boolean; message: string }[] = [];

  const examples: string[] = [];
  for await (const dir of $`find examples -maxdepth 1 -mindepth 1 -type d`.lines()) {
    if (dir) examples.push(dir);
  }

  for (const dir of examples) {
    // biome-ignore lint/performance/noAwaitInLoops: build examples sequentially to capture output correctly
    const result = await buildExample(dir, snapshots, newSnapshots);
    results.push(result);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("CSS Optimization Snapshot Results");
  console.log("=".repeat(60));

  let allPassed = true;
  for (const result of results) {
    const status = result.passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    console.log(`\n${status} ${result.example}`);
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
