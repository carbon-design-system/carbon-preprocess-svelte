import { writable } from "svelte/store";

/** Preview-wide settings the App owns and code views read. */
export const codeLanguage = writable("js"); // "js" | "ts"
export const packageManager = writable("npm"); // "npm" | "pnpm" | "yarn" | "bun"
/**
 * Loading techniques, each on by default and off with a URL flag, to compare:
 * - `lazy` (`?lazy=0`): mount live examples, code-view controls, and lines
 *   behind "Show more" only when near the viewport or idle.
 * - `cv` (`?cv=0`): `content-visibility: auto` on code blocks.
 * - `aot` (`?aot=0`): paint build-time tokens instead of tokenizing in the browser.
 */
export const perf = writable({ lazy: true, cv: true, aot: true });
/**
 * Synced code groups (`::: code-group group="…"`): the label selected in
 * each group. App.svelte keeps it in CCS's `LocalStorage`, so it's
 * remembered across pages and reloads, and synced across tabs.
 */
export const tabGroups = writable({});

/** The theme terminal blocks use: `undefined` follows the page. */
export const terminalTheme = writable(undefined);
export const syntaxMode = writable("build"); // "build" | "runtime" | "off"

/** The hover card: what to show, and the text range it's for. */
export const hover = writable(null); // { info, range, owner, line, viaKeyboard, lang } | null

let apiPromise;
/** The component API, loaded once, on first use. */
export function loadApi() {
  apiPromise ??= import("virtual:ccs-api").then((m) => m.default);
  return apiPromise;
}
