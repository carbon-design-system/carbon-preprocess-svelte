import {
  CarbonSvelte,
  RE_EXT_CSS,
  RE_EXT_STYLESHEET,
  RE_EXT_SVELTE,
  RE_MODULE_QUERY,
  RE_STYLE_QUERY,
} from "./constants";

export function isSvelteFile(id: string): id is `${string}.svelte` {
  return RE_EXT_SVELTE.test(id);
}

export function isCssFile(id: string): id is `${string}.css` {
  return RE_EXT_CSS.test(id);
}

/**
 * `carbon-components-svelte` as a whole path segment, so a consumer's own
 * path (a fork, a folder named after the package) doesn't match. Accepts
 * `\`: webpack reports Windows module paths with it.
 */
const RE_CARBON_COMPONENTS_SEGMENT = new RegExp(
  `(^|[\\\\/])${CarbonSvelte.Components}([\\\\/]|$)`,
);

export function isCarbonSvelteImport(id: string) {
  return isSvelteFile(id) && RE_CARBON_COMPONENTS_SEGMENT.test(id);
}

/** `App.svelte?svelte&type=style&lang.css` -> `App.svelte`. */
export function stripQuery(id: string): string {
  return id.replace(RE_MODULE_QUERY, "");
}

/**
 * Whether a bundled module's code should be scanned for literal `bx--`
 * tokens. Skips virtual modules (`\0` prefix), stylesheets (see
 * `RE_EXT_STYLESHEET`), Svelte `<style>` sub-modules, and files inside
 * `carbon-components-svelte`, which the component index covers more precisely.
 */
export function isScannableModule(id: string): boolean {
  if (id.startsWith("\0")) return false;
  if (RE_EXT_STYLESHEET.test(stripQuery(id)) || RE_STYLE_QUERY.test(id)) {
    return false;
  }
  return !RE_CARBON_COMPONENTS_SEGMENT.test(id);
}

/** Decodes a CSS asset source without copying the bytes. */
export function toCssString(source: Uint8Array | string): string {
  if (typeof source === "string") return source;
  return Buffer.from(
    source.buffer,
    source.byteOffset,
    source.byteLength,
  ).toString();
}

export function byteLength(source: Uint8Array | string): number {
  return typeof source === "string"
    ? Buffer.byteLength(source)
    : source.byteLength;
}
