import type { Failure, LibrarySpec } from "severan";
import { CarbonSvelte, PACKAGE_NAME } from "./constants";
import { extractCarbonClassTokens } from "./indexer/extract-runtime-classes";
import { collectCarbonTokens } from "./plugins/scan-content";

/** Carbon, as severan reads and rewrites it. */
export const CARBON: LibrarySpec = {
  name: CarbonSvelte.Components,
  srcDir: "src",
  barrel: "index.js",
  componentPackages: [CarbonSvelte.Icons, CarbonSvelte.Pictograms],
  contextKeyPrefix: "carbon:",
  label: "Carbon",
  tool: PACKAGE_NAME,
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
} satisfies Failure;

/** What the usage analysis turns off when it fails, for `optimizeComponents`. */
export const SPECIALIZE_FAILURE = {
  feature: "optimizeComponents",
  fallback: "Carbon components were bundled unchanged",
} satisfies Failure;
