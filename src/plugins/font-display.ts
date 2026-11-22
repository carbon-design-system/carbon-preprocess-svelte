export type FontDisplay = "auto" | "block" | "swap" | "fallback" | "optional";

const RE_FONT_FACE = /@font-face\s*\{[^}]*\}/g;
const RE_FONT_DISPLAY = /font-display\s*:\s*[a-z]+/;
const RE_IBM_PLEX = /IBM Plex/;

/**
 * `css` with each IBM Plex `@font-face` rule's `font-display` set to
 * `value`. Carbon's stylesheets ship `auto`, which hides text until the
 * font loads from IBM's CDN. Other `@font-face` rules stay as they are.
 */
export function setFontDisplay(css: string, value: FontDisplay | undefined) {
  if (!value) return css;
  return css.replace(RE_FONT_FACE, (rule) =>
    RE_IBM_PLEX.test(rule)
      ? rule.replace(RE_FONT_DISPLAY, `font-display:${value}`)
      : rule,
  );
}
