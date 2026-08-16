import { bench, group, run, summary } from "mitata";
import { buildComponentIndex } from "../src/indexer/build-index";

// Rebuilds the full component index from the installed `carbon-components-svelte`
// (file scan + CSS indexing + runtime-class graph). Runs once per build normally,
// or once per dev-server start with `experimental.liveIndex`, so this is a coarser
// end-to-end benchmark rather than a tight microbenchmark.
group("buildComponentIndex (full scan)", () => {
  summary(() => {
    bench("cold-ish rebuild", async () => {
      await buildComponentIndex();
    });
  });
});

await run();

// Bonus: one-off phase breakdown (scan / css index / runtime graph / total) to
// help point at *where* time goes, not just the aggregate.
const timings: Record<string, number> = {};
await buildComponentIndex({
  onTiming: (label, ms) => {
    timings[label] = ms;
  },
});

console.log("\nphase breakdown (single run, ms):");
for (const [label, ms] of Object.entries(timings)) {
  console.log(`  ${label.padEnd(16)} ${ms.toFixed(2)}`);
}
