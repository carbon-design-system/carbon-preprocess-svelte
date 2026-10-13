import { CarbonSvelte, RE_EXT_CSS, RE_STYLE_QUERY } from "./constants";
import {
  errorMessage,
  isSvelteFile,
  RE_EXT_STYLESHEET,
  stripQuery,
} from "./specializer/util";

export { errorMessage, isSvelteFile, stripQuery };

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

const SRC_SEGMENT = /(?:^|[\\/])carbon-components-svelte[\\/]src[\\/](.+)$/;
const BACKSLASH = /\\/g;

/** `…/carbon-components-svelte/src/Button/Button.svelte` -> `Button/Button.svelte`. */
export function carbonModuleKey(id: string): string | undefined {
  return SRC_SEGMENT.exec(id)?.[1].replace(BACKSLASH, "/");
}

/** The barrel, `src/index.js`, as `carbonModuleKey` names it. */
export const CARBON_BARREL_KEY = "index.js";

/**
 * `carbonModuleKey` of a Carbon component or the barrel: the modules whose
 * imports the analysis reads. `undefined` for any other module.
 */
export function carbonImportKey(id: string): string | undefined {
  const key = carbonModuleKey(stripQuery(id));
  return key && (key === CARBON_BARREL_KEY || isSvelteFile(key))
    ? key
    : undefined;
}

/**
 * One import of a Carbon component or the barrel, an edge of the bundler's
 * module graph: `id` is the Carbon module, `specifier` what `importer`
 * wrote, when the bundler says.
 */
export type CarbonImport = {
  id: string;
  importer: string;
  specifier?: string;
};

/**
 * Whether `specifier` names Carbon as the analysis reads it. Any other
 * import that resolves into Carbon (a bundler alias like `@carbon`) is
 * one the analysis can't see.
 */
export function isCarbonSpecifier(specifier: string): boolean {
  return (
    specifier === CarbonSvelte.Components ||
    specifier.startsWith(`${CarbonSvelte.Components}/`)
  );
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
