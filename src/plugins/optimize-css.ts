import Rollup from "rollup";
import sveltePreprocess from "svelte-preprocess";
import { preprocess } from "svelte/compiler";
import { extractSelectors, ExtractedSelectors } from "../extractors";
import purgecss from "purgecss";
import { readFile } from "../utils";
import { EXT_SVELTE, EXT_CSS } from "../constants";

// @ts-ignore
const { typescript } = sveltePreprocess;

// @ts-ignore
const { PurgeCSS } = purgecss;

interface OptimizeCssOptions {
  safelist: {
    standard?: Array<RegExp | string>;
    deep?: RegExp[];
    greedy?: RegExp[];
  };
}

export function optimizeCss(
  options?: Partial<OptimizeCssOptions>
): Rollup.Plugin {
  const selectors: ExtractedSelectors = [];
  const standard = [
    "*",
    "html",
    "body",
    /aria-current/,
    /^svelte-/,
    ...(options?.safelist?.standard ?? []),
  ];
  const deep = options?.safelist?.deep ?? [];
  const greedy = options?.safelist?.greedy ?? [];

  return {
    name: "plugin-optimize-css",
    async transform(code, id) {
      if (EXT_SVELTE.test(id)) {
        const source = await readFile(id, "utf-8");
        const result = await preprocess(source, [typescript()], {
          filename: id,
        });
        selectors.push(...extractSelectors(result.code, id));
        return { code, map: null };
      }
    },
    async generateBundle({}, bundle) {
      for (const fileName in bundle) {
        const chunkOrAsset = bundle[fileName];

        if (chunkOrAsset.type === "asset" && EXT_CSS.test(fileName)) {
          const content = [...selectors.map((selector) => selector[0] + "{}")];
          const purgeCSSResult = await new PurgeCSS().purge({
            content: [{ raw: content.join(" "), extension: "css" }],
            css: [{ raw: chunkOrAsset.source as string }],
            keyframes: true,
            fontFace: true,
            safelist: {
              standard,
              deep,
              greedy: [
                ...greedy,
                ...selectors
                  .filter((selector) => selector[0].endsWith("-"))
                  .map((selector) => {
                    if (selector[0][0] === ".") {
                      return new RegExp(selector[0].slice(1));
                    }

                    return new RegExp(selector[0]);
                  }),
              ],
            },
          });

          if (purgeCSSResult[0]) {
            this.emitFile({
              type: "asset",
              fileName,
              source: purgeCSSResult[0].css,
            });
          }
        }
      }
    },
  };
}
