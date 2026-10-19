// Runs the MountBench page and prints ms and DOM nodes per instance.
import { chromium } from "playwright";

const b = await chromium.launch();
const p = await b.newPage();
await p.goto(
  `${process.env.PLAYGROUND_URL ?? "http://localhost:5173"}/?chrome=0&lazy=0&page=MountBench`,
  { waitUntil: "networkidle" },
);
await p.waitForSelector("#bench-results[data-done]", {
  state: "attached",
  timeout: 60000,
});
const results = JSON.parse((await p.textContent("#bench-results")) ?? "[]") as {
  name: string;
  msPerInstance: number;
  nodesPerInstance: number;
}[];
for (const r of results.sort((a, b) => b.msPerInstance - a.msPerInstance))
  console.log(
    `${r.name.padEnd(24)} ${r.msPerInstance.toFixed(3).padStart(7)} ms  ${String(r.nodesPerInstance).padStart(4)} nodes`,
  );
await b.close();
