import type { Failure, LibrarySpec } from "svelte-prune";
import { CarbonSvelte, PACKAGE_NAME } from "./constants";
import { collectCarbonTokens } from "./plugins/scan-content";

/**
 * A Carbon class, with the breakpoint ones CSS Grid columns build
 * (`bx--lg:col-span-4`). `bx--lg:` alone is a prefix: svelte-prune keeps
 * every class starting with it.
 */
const CLASS_TOKEN = /(?<![\w-])bx--[\w-]+(?::[\w-]*)?/g;

/** Carbon, as svelte-prune reads and rewrites it. */
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
    text: (text) =>
      Array.from(text.matchAll(CLASS_TOKEN), ([token]) => `.${token}`),
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
