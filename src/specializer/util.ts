/** A `.svelte` module path. */
export const RE_EXT_SVELTE = /\.svelte$/;

/** Splits a bundler module id into its path and its `?query#hash` suffix. */
export const RE_MODULE_QUERY = /[?#].*$/;

/** `.css` and the preprocessor files a bundler compiles to CSS. */
export const RE_EXT_STYLESHEET =
  /\.(css|scss|sass|less|styl|stylus|pcss|postcss)$/;

export function isSvelteFile(id: string): id is `${string}.svelte` {
  return RE_EXT_SVELTE.test(id);
}

/** `App.svelte?svelte&type=style&lang.css` -> `App.svelte`. */
export function stripQuery(id: string): string {
  return id.replace(RE_MODULE_QUERY, "");
}

/** A thrown value's message, for a warning. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
