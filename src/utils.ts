import {
  errorMessage,
  isSvelteFile,
  RE_EXT_STYLESHEET,
  stripQuery,
} from "svelte-prune/internal";
import { CarbonSvelte, RE_EXT_CSS, RE_STYLE_QUERY } from "./constants";

export { errorMessage, isSvelteFile, stripQuery };

// For a value read off disk or from another tool, before its fields are.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isCssFile(id: string): id is `${string}.css` {
  return RE_EXT_CSS.test(id);
}

// A whole path segment, so a consumer's own path (a fork, a folder named
// after the package) doesn't match. Accepts `\`, since webpack reports
// Windows module paths with it.
const RE_CARBON_COMPONENTS_SEGMENT = new RegExp(
  `(^|[\\\\/])${CarbonSvelte.Components}([\\\\/]|$)`,
);

export function isCarbonSvelteImport(id: string) {
  return isSvelteFile(id) && RE_CARBON_COMPONENTS_SEGMENT.test(id);
}

// Only app code is scanned for literal `bx--` tokens: not virtual modules
// (`\0` prefix), stylesheets (see `RE_EXT_STYLESHEET`), Svelte `<style>`
// sub-modules, or files inside `carbon-components-svelte`, which the
// usage analysis reads more precisely.
export function isScannableModule(id: string): boolean {
  if (id.startsWith("\0")) return false;
  if (RE_EXT_STYLESHEET.test(stripQuery(id)) || RE_STYLE_QUERY.test(id)) {
    return false;
  }
  return !RE_CARBON_COMPONENTS_SEGMENT.test(id);
}

// A view over the same memory, so the bytes aren't copied
// before decoding.
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
