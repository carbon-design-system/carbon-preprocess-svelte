import { CarbonSvelte } from "./constants";
import { extractCarbonClassTokens } from "./indexer/extract-runtime-classes";
import { collectCarbonTokens } from "./plugins/scan-content";
import type { LibrarySpec } from "./specializer/library";

/** Carbon, as the specializer reads and rewrites it. */
export const CARBON: LibrarySpec = {
  name: CarbonSvelte.Components,
  srcDir: "src",
  barrel: "index.js",
  componentPackages: [CarbonSvelte.Icons, CarbonSvelte.Pictograms],
  contextKeyPrefix: "carbon:",
  label: "Carbon",
  tool: "carbon-preprocess-svelte",
  classTokens: {
    marker: "bx--",
    text: (text) => extractCarbonClassTokens(text),
    script: collectCarbonTokens,
  },
};

/** What the usage analysis turns off when it fails, for `propAware`. */
export const PROP_AWARE_FAILURE = {
  feature: "propAware",
  fallback: "Carbon CSS was pruned without it",
};

/** What the usage analysis turns off when it fails, for `optimizeComponents`. */
export const SPECIALIZE_FAILURE = {
  feature: "optimizeComponents",
  fallback: "Carbon components were bundled unchanged",
};
