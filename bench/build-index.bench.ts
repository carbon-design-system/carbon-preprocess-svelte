import { readFileSync } from "node:fs";
import path from "node:path";
import { group, task } from "ostia";
import { getComponents } from "../src/component-index-registry";
import { CarbonSvelte } from "../src/constants";
import {
  buildComponentIndex,
  resolveCarbonRoot,
} from "../src/indexer/build-index";
import {
  extractCssIndexAdditions,
  resolveCarbonCssPath,
} from "../src/indexer/extract-css-context";
import {
  buildRuntimeClassMap,
  type ModuleGraphCache,
} from "../src/indexer/extract-runtime-classes";
import { extractFromSvelte } from "../src/indexer/extract-selectors";
import { listJsAndSvelteFiles } from "../src/indexer/list-files";
import { isSvelteFile } from "../src/utils";

const carbonRoot = resolveCarbonRoot();
const carbonSrc = path.join(carbonRoot, "src");

// Rebuilds the full component index from the installed `carbon-components-svelte`
// (file scan + CSS indexing + runtime-class graph). Runs once per build normally,
// or once per dev-server start with `experimental.liveIndex`, so this is a coarser
// end-to-end benchmark rather than a tight microbenchmark.
group("buildComponentIndex (full scan)", () => {
  task("cold-ish rebuild", async () => {
    await buildComponentIndex();
  });
});

// The phases behind the aggregate, each on the same real inputs the full
// build uses, so a regression can be pinned to one of them.
const DATA_TABLE = readFileSync(
  path.join(carbonSrc, "DataTable/DataTable.svelte"),
  "utf8",
);
const BUTTON = readFileSync(
  path.join(carbonSrc, "Button/Button.svelte"),
  "utf8",
);
const carbonCss = readFileSync(resolveCarbonCssPath(carbonRoot), "utf8");

// Inputs for the CSS pass, derived from the frozen index: every exported
// component's classes, keyed the way `buildComponentIndex` keys them.
const components = getComponents();
const componentClasses = new Map<string, Set<string>>();
const moduleToComponent = new Map<string, string>();
const srcPrefix = `${CarbonSvelte.Components}/src/`;
for (const [name, entry] of Object.entries(components)) {
  componentClasses.set(name, new Set(entry.classes));
  if (entry.path.endsWith(".svelte")) {
    moduleToComponent.set(entry.path.slice(srcPrefix.length), name);
  }
}

// The full build hands `buildRuntimeClassMap` the import graph of every
// `.svelte` module it already parsed, so only `.js` utilities get loaded
// on demand. Reproduce that once here; each trial starts from a copy.
const files = await listJsAndSvelteFiles(carbonSrc);
const scanned: ModuleGraphCache = {
  importsByModule: new Map(),
  runtimeByModule: new Map(),
  files: new Set(files),
};
for (const file of files) {
  if (file.startsWith("icons/") || !isSvelteFile(file)) continue;
  const extracted = extractFromSvelte({
    code: readFileSync(path.join(carbonSrc, file), "utf8"),
    filename: file,
  });
  scanned.importsByModule.set(file, extracted.imports);
  if (extracted.runtimeClasses.length > 0) {
    scanned.runtimeByModule.set(file, new Set(extracted.runtimeClasses));
  }
}

group("buildComponentIndex phases", () => {
  task("listJsAndSvelteFiles (src walk)", async () => {
    await listJsAndSvelteFiles(carbonSrc);
  });

  task("extractFromSvelte (Button.svelte)", () => {
    extractFromSvelte({ code: BUTTON, filename: "Button/Button.svelte" });
  });

  task("extractFromSvelte (DataTable.svelte)", () => {
    extractFromSvelte({
      code: DATA_TABLE,
      filename: "DataTable/DataTable.svelte",
    });
  });

  task("extractCssIndexAdditions (white.css)", () => {
    extractCssIndexAdditions({
      componentClasses,
      slotWrapperClasses: new Map(),
      subComponents: new Map(),
      css: carbonCss,
    });
  });

  task("buildRuntimeClassMap (svelte graph pre-scanned)", async () => {
    await buildRuntimeClassMap(carbonSrc, moduleToComponent, {
      importsByModule: new Map(scanned.importsByModule),
      runtimeByModule: new Map(scanned.runtimeByModule),
      files: scanned.files,
    });
  });
});

// Bonus: one-off phase breakdown (scan / css index / runtime graph / total) to
// help point at *where* time goes, not just the aggregate.
// Note: this suite runs via the `ostia bench` CLI (not ostia's in-file run()),
// so this block executes during suite import, before the benchmark table below
// is printed, not after like it did with mitata.
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
