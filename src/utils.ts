import { RE_EXT_CSS, RE_EXT_SVELTE } from "./constants";

export function isSvelteFile(id: string): id is `${string}.svelte` {
  return RE_EXT_SVELTE.test(id);
}

export function isCssFile(id: string): id is `${string}.css` {
  return RE_EXT_CSS.test(id);
}
