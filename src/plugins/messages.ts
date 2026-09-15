/** Prefix for every warning either plugin raises, so users can grep for it. */
export const WARN_PREFIX = "carbon-preprocess-svelte:";

export const NO_CARBON_IMPORTS =
  `${WARN_PREFIX} no carbon-components-svelte component imports were found in this build, so no Carbon CSS was pruned. ` +
  'If you expected pruning, check that components are imported from "carbon-components-svelte" (importing only the stylesheet is not enough) ' +
  "and that the plugin is part of the production build.";
