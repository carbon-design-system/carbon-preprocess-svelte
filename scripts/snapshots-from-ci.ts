/**
 * Applies the e2e size snapshots CI observed on this branch's head, for
 * when a change moves them on purpose: the `test` workflow uploads what
 * it saw (`e2e-snapshots`) whenever the e2e step fails. Prints each entry
 * that changes.
 *
 *   bun run snapshots:from-ci [run-id]
 *
 * Needs the GitHub CLI (`gh`), signed in. Without a run id, takes the
 * latest `test` run for the current commit.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { $ } from "bun";

const SNAPSHOT_PATH = path.join(
  import.meta.dir,
  "../tests/__snapshots__/e2e.json",
);

type Result = { after_kb: number };
type Snapshots = Record<string, Result | Record<string, Result>>;

async function latestRun(): Promise<string> {
  const head = (await $`git rev-parse HEAD`.text()).trim();
  const runs = JSON.parse(
    await $`gh run list --commit ${head} --workflow test.yml --json databaseId,conclusion --limit 1`.text(),
  ) as Array<{ databaseId: number; conclusion: string }>;
  if (runs.length === 0) {
    throw new Error(`No test run for ${head.slice(0, 7)}: push it first.`);
  }
  return String(runs[0].databaseId);
}

/** `vite-matrix@svelte-4/css` -> after_kb, for every entry. */
function flatten(snapshots: Snapshots): Map<string, number> {
  const entries = new Map<string, number>();
  for (const [name, value] of Object.entries(snapshots)) {
    if ("after_kb" in value) {
      entries.set(name, (value as Result).after_kb);
      continue;
    }
    for (const [entry, result] of Object.entries(value)) {
      entries.set(`${name}/${entry}`, (result as Result).after_kb);
    }
  }
  return entries;
}

const run = process.argv[2] ?? (await latestRun());
const dir = mkdtempSync(path.join(tmpdir(), "e2e-snapshots-"));
try {
  const download =
    await $`gh run download ${run} --name e2e-snapshots --dir ${dir}`
      .nothrow()
      .quiet();
  if (download.exitCode !== 0) {
    throw new Error(
      `Run ${run} has no e2e-snapshots artifact (it's uploaded only when the e2e step fails).`,
    );
  }
  const observed = readFileSync(path.join(dir, "e2e-observed.json"), "utf8");
  const before = flatten(JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")));
  const after = flatten(JSON.parse(observed));
  writeFileSync(SNAPSHOT_PATH, observed);

  let changed = 0;
  for (const [name, kb] of after) {
    const was = before.get(name);
    if (was === kb) continue;
    changed++;
    const delta =
      was === undefined ? "new" : `${(((kb - was) / was) * 100).toFixed(1)}%`;
    console.log(`  ${name}: ${was ?? "-"} kB -> ${kb} kB (${delta})`);
  }
  console.log(
    `${changed} snapshot${changed === 1 ? "" : "s"} updated from run ${run}: ${path.relative(process.cwd(), SNAPSHOT_PATH)}`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
