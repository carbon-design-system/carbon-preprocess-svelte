import {
  CarbonSvelte,
  RE_EXT_CSS,
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

export function isCarbonSvelteImport(id: string) {
  return isSvelteFile(id) && id.includes(CarbonSvelte.Components);
}

/** Strip a bundler query/hash suffix: `App.svelte?svelte&type=style&lang.css` -> `App.svelte`. */
export function stripQuery(id: string): string {
  return id.replace(RE_MODULE_QUERY, "");
}

/**
 * Whether a bundled module's code should be scanned for literal `bx--`
 * tokens. Skips virtual modules (`\0` prefix), CSS modules (their `bx--`
 * selectors are the thing being pruned, not evidence of use), and anything
 * inside `carbon-components-svelte` itself (the component index already
 * covers Carbon's own sources more precisely than a token scan would).
 */
export function isScannableModule(id: string): boolean {
  if (id.startsWith("\0")) return false;
  if (isCssFile(stripQuery(id)) || isCssFile(id)) return false;
  if (RE_STYLE_QUERY.test(id)) return false;
  if (id.includes(CarbonSvelte.Components)) return false;
  return true;
}
