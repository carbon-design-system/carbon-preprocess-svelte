import { join } from "path";

export const CARBON_SVELTE = {
  components: "carbon-components-svelte",
  icons: "carbon-icons-svelte",
  pictograms: "carbon-pictograms-svelte",
};

export const LATEST_MAJOR_VERSION = {
  [CARBON_SVELTE.components]: "0",
  [CARBON_SVELTE.icons]: "10",
  [CARBON_SVELTE.pictograms]: "11",
};

export const API_COMPONENTS = join(__dirname, `${CARBON_SVELTE.components}.js`);
export const API_ELEMENTS = join(__dirname, "carbon-elements.js");
export const API_ICONS = join(__dirname, "carbon-icons.js");
export const API_PICTOGRAMS = join(__dirname, "carbon-pictograms.js");

export const EXT_SVELTE = /\.(svelte)$/;
export const EXT_CSS = /\.(css)$/;
