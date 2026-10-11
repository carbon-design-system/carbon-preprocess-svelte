// CPU time of a page load by source file (inclusive of callees within the file's own frames): bun profile-files.ts "<query>"
import { chromium } from "playwright";

const query = process.argv[2] ?? "page=ComboBox";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(
  `${process.env.PLAYGROUND_URL ?? "http://localhost:5173"}/?chrome=0&${query}`,
  { waitUntil: "networkidle" },
);
const cdp = await p.context().newCDPSession(p);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
await cdp.send("Profiler.start");
await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(800);
const { profile } = await cdp.send("Profiler.stop");
// Attribute each sample to the nearest frame from a project file (not the Svelte runtime or native).
const parent = new Map<number, number>();
for (const n of profile.nodes)
  for (const c of n.children ?? []) parent.set(c, n.id);
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const fileOf = (id: number | undefined): string => {
  while (id !== undefined) {
    const url = byId.get(id)?.callFrame.url;
    if (url && !/node_modules|runtime|index-client|\.vite\/deps/.test(url))
      return url.split("/").slice(-2).join("/").split("?")[0];
    id = parent.get(id);
  }
  return "(runtime/native)";
};
const totals = new Map<string, number>();
profile.samples?.forEach((id, i) => {
  const n = byId.get(id);
  if (!n) return;
  if (["(idle)", "(program)"].includes(n.callFrame.functionName)) return;
  const f = fileOf(id);
  totals.set(f, (totals.get(f) ?? 0) + (profile.timeDeltas?.[i] ?? 0) / 1000);
});
for (const [k, v] of [...totals].sort((a, b) => b[1] - a[1]).slice(0, 12))
  console.log(v.toFixed(1).padStart(7), k);
await b.close();
