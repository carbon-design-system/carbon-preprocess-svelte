export const CarbonSvelte = {
  Components: "carbon-components-svelte",
  Icons: "carbon-icons-svelte",
  Pictograms: "carbon-pictograms-svelte",
} as const;

export const CARBON_PREFIX = /bx--/;

export const ALWAYS_ON_CLASSES = [".bx--body"];

/**
 * Ancestor classes that may appear in strict selectors without being imported.
 * Subject classes still require a full allowlist match.
 */
export const CONTEXT_ANCESTORS = [
  ".bx--body--with-modal-open",
  ".bx--header__global",
  ".bx--side-nav-collapse-icon",
  ".bx--side-nav-expand-icon",
] as const;

export const RE_EXT_SVELTE = /\.svelte$/;

export const RE_EXT_CSS = /\.css$/;

/** Splits a bundler module id into its path and its `?query#hash` suffix. */
export const RE_MODULE_QUERY = /[?#].*$/;

/** Matches a Vite Svelte style sub-module query (`?svelte&type=style&...`). */
export const RE_STYLE_QUERY = /type=style/;

// Vite uses the decimal system for file sizes.
export const BITS_DENOM = 1_000;
