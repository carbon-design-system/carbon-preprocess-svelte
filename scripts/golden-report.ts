/**
 * What still keeps variants in the golden apps (`golden/`): for each app,
 * the `optimizeComponents` report, then every reason a prop value or a
 * whole call site stayed unknown, grouped across apps and ranked by how
 * often it comes up. The top of the list is where the analysis (or
 * Carbon) can win the most.
 *
 *   bun scripts/golden-report.ts [--only admin-dashboard] [--full]
 */

import path from "node:path";
import { parseArgs } from "node:util";
import { specializeFiles } from "severan/internal/analysis";
import { CARBON, SPECIALIZE_FAILURE } from "../src/carbon-library";
import { goldenApps } from "./golden-apps";

const { values: args } = parseArgs({
  options: {
    only: { type: "string" },
    // Print each app's whole report, not just its summary.
    full: { type: "boolean" },
  },
});

const ROOT = path.resolve(import.meta.dir, "..");
const UNKNOWN_PROP = /^ {6}(\S+) +dynamic(?: \(\+ default\))?: (.+)$/;
const OPEN_SITE = /^ {6}every variant kept: (.+)$/;
const COMPONENT = /^ {4}(\S+) \(\d+ call sites?\)$/;
const LOCATION = /^\S+\.svelte:\d+ /;

/** A reason with its specifics (names, lines, files) blanked out. */
function kindOf(reason: string): string {
  return reason
    .replace(LOCATION, "")
    .replace(/`[^`]*`/g, "`…`")
    .replace(/\bat line \d+/g, "at line …")
    .replace(/at \S+:\d+/g, "at …");
}

const kinds = new Map<string, string[]>();
const record = (kind: string, example: string) => {
  const list = kinds.get(kind) ?? [];
  list.push(example);
  kinds.set(kind, list);
};

for (const app of goldenApps(ROOT, args.only)) {
  // biome-ignore lint/performance/noAwaitInLoops: one app at a time keeps output readable
  const result = await specializeFiles({
    library: CARBON,
    failure: SPECIALIZE_FAILURE,
    projectRoot: ROOT,
    files: app.files,
    options: { unwrap: true },
  });
  if ("warning" in result) {
    console.log(`\n${app.id}: ${result.warning}`);
    continue;
  }
  const lines = result.report();
  const summary = lines.filter((line) => line.startsWith("  Rewrote"));
  console.log(`\n${app.id}`);
  for (const line of summary) console.log(line);
  if (args.full) for (const line of lines) console.log(line);

  let component = "";
  for (const line of lines) {
    const header = COMPONENT.exec(line);
    if (header) {
      component = header[1];
      continue;
    }
    const prop = UNKNOWN_PROP.exec(line);
    if (prop) {
      record(kindOf(prop[2]), `${app.id}: ${component}.${prop[1]}: ${prop[2]}`);
      continue;
    }
    const open = OPEN_SITE.exec(line);
    if (open) {
      record(
        `every variant kept: ${kindOf(open[1])}`,
        `${app.id}: ${component}: ${open[1]}`,
      );
    }
  }
}

console.log("\nWhy values stay unknown, most frequent first:");
for (const [kind, examples] of [...kinds].sort(
  (a, b) => b[1].length - a[1].length,
)) {
  console.log(`\n  ${String(examples.length).padStart(3)}  ${kind}`);
  for (const example of examples.slice(0, 4))
    console.log(`         ${example}`);
  if (examples.length > 4)
    console.log(`         … ${examples.length - 4} more`);
}
