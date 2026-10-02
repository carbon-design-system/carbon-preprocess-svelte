import { filterCss } from "caligula";
import {
  isFlatpickrKeyframes,
  isUnusedIbmPlexFontFace,
  pruneRuleSelector,
  type StrictCssOptimizerOptions,
} from "./strict-css-optimizer";

export type SpliceOptimizerOptions = StrictCssOptimizerOptions & {
  preserveAllIBMFonts: boolean;
};

// Always validated, so which inputs pass through unchanged doesn't depend on
// `preserveAllIBMFonts`.
const READ_DECLS = ["font-face"];

/**
 * Carbon's pruning rules on top of caligula, which edits the source text
 * instead of round-tripping it through an AST. Input caligula can't
 * reproduce exactly (a syntax error, an ambiguous `@font-face` descriptor)
 * comes back unchanged with `removed: 0`.
 */
export function spliceOptimizeCss(
  css: string,
  options: SpliceOptimizerOptions,
): { css: string; removed: number } {
  let removed = 0;

  const result = filterCss(css, {
    readDecls: READ_DECLS,
    rule({ selector }) {
      const pruned = pruneRuleSelector(selector, options);
      if (!pruned) return;
      removed += pruned.removed;
      return pruned.selector ?? false;
    },
    atRule(atRule) {
      if (isFlatpickrKeyframes(atRule.name, atRule.params, options)) {
        removed++;
        return false;
      }

      if (!options.preserveAllIBMFonts && atRule.name === "font-face") {
        let family = "";
        let style = "";
        let weight = "";
        atRule.walkDecls((prop, value) => {
          if (prop === "font-family") family = value;
          else if (prop === "font-style") style = value;
          else if (prop === "font-weight") weight = value;
        });
        if (isUnusedIbmPlexFontFace(family, style, weight, options)) {
          removed++;
          return false;
        }
      }
    },
  });

  return { css: result.css, removed };
}
