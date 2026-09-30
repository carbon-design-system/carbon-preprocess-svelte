import { filterCss } from "caligula";
import {
  isFlatpickrKeyframes,
  isUnusedIbmPlexFontFace,
  pruneRuleSelector,
  type StrictCssOptimizerOptions,
} from "./strict-css-optimizer";

/**
 * Carbon's pruning rules on top of caligula, which edits the source text
 * instead of round-tripping it through a PostCSS AST. Output is
 * byte-identical to the same rules run as PostCSS visitors; input caligula
 * can't reproduce exactly (a syntax error, or an ambiguous `@font-face`
 * descriptor) comes back unchanged with `removed: 0`.
 */

export type SpliceOptimizerOptions = StrictCssOptimizerOptions & {
  preserveAllIBMFonts: boolean;
};

// `@font-face` descriptors are always validated, whether or not
// `preserveAllIBMFonts` means they get read, so the set of inputs that pass
// through unchanged doesn't depend on options.
const READ_DECLS = ["font-face"];

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

/**
 * Calls `onRule` with each rule's selector, in pre-order document order.
 * Throws for input caligula would skip: a build-time indexing pass has no
 * "unchanged" to fall back to.
 */
export function forEachRuleSelector(
  css: string,
  onRule: (selector: string) => void,
): void {
  const { skipped } = filterCss(css, {
    rule({ selector }) {
      onRule(selector);
    },
  });
  if (skipped) {
    throw new Error(
      "forEachRuleSelector: input is outside the shape caligula models",
    );
  }
}
