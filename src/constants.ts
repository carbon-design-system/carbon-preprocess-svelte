export const CARBON_SVELTE = {
  components: "carbon-components-svelte",
  icons: "carbon-icons-svelte",
  pictograms: "carbon-pictograms-svelte",
};

export const LATEST_MAJOR_VERSION = {
  [CARBON_SVELTE.components]: "0",
  [CARBON_SVELTE.icons]: "11",
  [CARBON_SVELTE.pictograms]: "12",
};

export const API_COMPONENTS = `src/${CARBON_SVELTE.components}.js`;
export const API_ELEMENTS = "src/carbon-elements.js";
export const API_ICONS = "src/carbon-icons.js";
export const API_PICTOGRAMS = "src/carbon-pictograms.js";

export const EXT_SVELTE = /\.(svelte)$/;
export const EXT_CSS = /\.(css)$/;
