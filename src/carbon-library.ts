import type { Failure, LibrarySpec } from "svelte-prune";
import { CarbonSvelte, PACKAGE_NAME } from "./constants";
import { collectCarbonTokens } from "./plugins/scan-content";

// The `:` part is for the breakpoint classes CSS Grid columns build
// (`bx--lg:col-span-4`). `bx--lg:` alone matches too, as a prefix, since
// svelte-prune keeps every class starting with it.
const CLASS_TOKEN = /(?<![\w-])bx--[\w-]+(?::[\w-]*)?/g;

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

export const CSS_FAILURE = {
  feature: "optimizeCss",
  fallback: "Carbon CSS is left unpruned",
} satisfies Failure;

export const SPECIALIZE_FAILURE = {
  feature: "optimizeComponents",
  fallback: "Carbon components were bundled unchanged",
} satisfies Failure;
