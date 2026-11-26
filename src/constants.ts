export const CarbonSvelte = {
  Components: "carbon-components-svelte",
  Icons: "carbon-icons-svelte",
  Pictograms: "carbon-pictograms-svelte",
} as const;

export const PACKAGE_NAME = "carbon-preprocess-svelte";

// On every warning and error the package logs, so users can grep for it.
export const LOG_PREFIX = `${PACKAGE_NAME}:`;

export const ALWAYS_ON_CLASSES = [".bx--body"];

// Kept without a component rendering them, since the app or a third party
// sets them on an ancestor at runtime. A selector's subject must still be
// something that renders.
export const CONTEXT_ANCESTORS = [
  ".bx--body--with-modal-open",
  ".bx--header__global",
  ".bx--side-nav-collapse-icon",
  ".bx--side-nav-expand-icon",
] as const;

export const RE_EXT_CSS = /\.css$/;

export const RE_STYLE_QUERY = /[?&]type=style(&|$)/;

// Not 1,024, since Vite reports file sizes in decimal units.
export const BYTES_PER_KB = 1_000;
