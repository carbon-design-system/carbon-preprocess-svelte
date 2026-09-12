import type { SpliceOptimizerOptions } from "carbon-preprocess-svelte/plugins/css-splice-optimizer";
import {
  isFlatpickrKeyframes,
  isUnusedIbmPlexFontFace,
  pruneRuleSelector,
} from "carbon-preprocess-svelte/plugins/strict-css-optimizer";
import type { AcceptedPlugin, AtRule, Rule } from "postcss";
import postcss from "postcss";
import discardEmpty from "postcss-discard-empty";

/**
 * The PostCSS reference implementation `css-splice-optimizer.ts` is checked
 * against: a real PostCSS AST walk applying the same pure allowlist/safelist
 * logic (`pruneRuleSelector`, `isFlatpickrKeyframes`, `isUnusedIbmPlexFontFace`,
 * all exported from `src/` and shared with the scanner) plus
 * `postcss-discard-empty` for the container cleanup. This is what
 * `src/plugins/create-optimized-css.ts` fell back to before the scanner was
 * finished; PostCSS stays a devDependency for this file only.
 */

function optimizeStrictRule(
  node: Rule,
  options: Parameters<typeof pruneRuleSelector>[1],
): number {
  const pruned = pruneRuleSelector(node.selector, options);
  if (!pruned) return 0;

  if (pruned.selector === null) {
    node.remove();
  } else {
    node.selector = pruned.selector;
  }

  return pruned.removed;
}

function optimizeStrictAtRule(
  node: AtRule,
  options: Pick<SpliceOptimizerOptions, "preserveFlatpickr">,
): number {
  if (isFlatpickrKeyframes(node.name, node.params, options)) {
    node.remove();
    return 1;
  }

  return 0;
}

function createPostcssPlugins(
  allowlist: Set<string>,
  preserveAllIBMFonts: boolean,
  preserveFlatpickr: boolean,
  safelist: SpliceOptimizerOptions["safelist"],
  report: { removed: number },
): AcceptedPlugin[] {
  return [
    {
      postcssPlugin: "postcss-plugin:carbon:optimize-css",
      Rule(node) {
        report.removed += optimizeStrictRule(node, {
          allowlist,
          preserveFlatpickr,
          safelist,
        });
      },
      AtRule(node) {
        report.removed += optimizeStrictAtRule(node, { preserveFlatpickr });
        if (!node.parent) return;

        if (!preserveAllIBMFonts && node.name === "font-face") {
          const attributes = {
            "font-family": "",
            "font-style": "",
            "font-weight": "",
          };

          node.walkDecls((decl) => {
            switch (decl.prop) {
              case "font-family":
              case "font-style":
              case "font-weight":
                attributes[decl.prop] = decl.value;
                break;
            }
          });

          if (
            isUnusedIbmPlexFontFace(
              attributes["font-family"],
              attributes["font-style"],
              attributes["font-weight"],
            )
          ) {
            node.remove();
            report.removed++;
          }
        }
      },
    },
    discardEmpty(),
  ];
}

export function optimizeCssWithPostcss(
  input: string,
  options: SpliceOptimizerOptions,
): { css: string; removed: number } {
  const report = { removed: 0 };
  const { css } = postcss(
    createPostcssPlugins(
      options.allowlist,
      options.preserveAllIBMFonts,
      options.preserveFlatpickr,
      options.safelist,
      report,
    ),
  ).process(input);
  return { css, removed: report.removed };
}
