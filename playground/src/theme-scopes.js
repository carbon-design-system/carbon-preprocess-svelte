// Themed regions. CCS's all.css defines each theme's tokens on `:root`
// (white) and `:root[theme=…]`, so a theme applies only to the whole page.
// This copies each theme's custom properties onto `.t-<theme>` and onto any
// element with a `theme` attribute, so a block can carry its own theme
// (a dark terminal on a light page). The CCS change this stands in for is
// widening its selectors from `:root[theme=x]` to `[theme=x]`.
import cssText from "carbon-components-svelte/css/all.css?raw";

const ROOT_BLOCK = /:root(?:\[theme=(\w+)\])?\{([^}]*)\}/g;

const vars = {};
for (const [, theme = "white", body] of cssText.matchAll(ROOT_BLOCK)) {
  const decls = body.split(";").filter((d) => d.trim().startsWith("--"));
  if (!vars[theme]) vars[theme] = [];
  vars[theme].push(...decls);
}

const dark = new Set(["g80", "g90", "g100"]);

/**
 * CSS for `.t-<theme>` and `[theme=<theme>]` regions. A theme's block in
 * all.css lists only the tokens that differ from white's, so each region
 * gets white's full set first, then its own: a Gray 10 region inside a dark
 * page must not inherit the page's light text.
 */
export const themeScopeCss = Object.entries(vars)
  .map(([theme, decls]) => {
    const all = theme === "white" ? decls : [...vars.white, ...decls];
    return `.t-${theme},[theme="${theme}"]:not(:root){${all.join(";")};color-scheme:${dark.has(theme) ? "dark" : "light"}}`;
  })
  .join("\n");
