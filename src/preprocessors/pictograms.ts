import { PreprocessorGroup } from "svelte/types/compiler/preprocess";
import { BuildPictograms, PictogramName } from "../build/build-pictograms";
import { walkAndReplace } from "../walk-and-replace";
import * as Pictograms from "../carbon-pictograms";
import { EXT_SVELTE } from "../constants";

const carbonPictograms = Pictograms.pictograms as BuildPictograms;

const defaultPictogramAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 32 32",
  fill: "currentColor",
  focusable: "false",
  preserveAspectRatio: "xMidYMid meet",
};

export function pictograms(): Pick<PreprocessorGroup, "markup"> {
  return {
    markup({ filename, content }) {
      if (!/node_modules/.test(filename) && EXT_SVELTE.test(filename)) {
        const code = walkAndReplace(
          { type: "markup", content, filename },
          ({ node }, replaceContent, getContent) => {
            if (node.type === "Element" && node.name === "pictogram") {
              let name: string | undefined;

              const attributes = node.attributes
                .map((attribute) => {
                  if (attribute.name === "name") {
                    if (Array.isArray(attribute.value)) {
                      name = attribute.value[0].raw;
                    }

                    return undefined;
                  }

                  return attribute;
                })
                .filter(Boolean);

              if (name === undefined) {
                console.warn("[carbon:pictograms] Pictogram name is required");
              }

              if (name !== undefined && name in carbonPictograms.pictograms) {
                const pictogram =
                  carbonPictograms.pictograms[name as PictogramName];
                const svgAttributes: Record<string, any> = {};

                Object.entries(defaultPictogramAttributes).forEach(
                  ([attribute, value]) => {
                    svgAttributes[attribute] = JSON.stringify(value);
                  }
                );

                Object.entries(pictogram.attributes).forEach(
                  ([attribute, value]) => {
                    svgAttributes[attribute] = JSON.stringify(value);
                  }
                );

                attributes.forEach((attribute) => {
                  const value = getContent(attribute!);

                  if (/^\{|$\}/.test(value)) {
                    svgAttributes[attribute!.name] = value;
                  } else {
                    svgAttributes[attribute!.name] = value.slice(
                      attribute!.name.length + 1
                    );
                  }
                });

                const attrs = Object.entries(svgAttributes)
                  .map(([attribute, value]) => `${attribute}=${value}`)
                  .join(" ");

                const markup = `<svg ${attrs}>${pictogram.children}</svg>`;

                replaceContent(node, markup);
              } else {
                console.warn(
                  `[carbon:pictograms] invalid pictogram name "${name}"`
                );
              }
            }
          }
        );

        return { code };
      }

      return { code: content };
    },
  };
}
