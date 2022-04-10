import { PreprocessorGroup } from "svelte/types/compiler/preprocess";
import { BuildIcons, IconName } from "../build/build-icons";
import { walkAndReplace } from "../walk-and-replace";
import * as Icons from "../carbon-icons";
import { EXT_SVELTE } from "../constants";

const carbonIcons = Icons.icons as BuildIcons;

const defaultIconAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 32 32",
  fill: "currentColor",
  focusable: "false",
  preserveAspectRatio: "xMidYMid meet",
};

export function icons(): Pick<PreprocessorGroup, "markup"> {
  return {
    markup({ filename, content }) {
      if (filename && !/node_modules/.test(filename) && EXT_SVELTE.test(filename)) {
        const code = walkAndReplace(
          { type: "markup", content, filename },
          ({ node }, replaceContent, getContent) => {
            if (node.type === "Element" && node.name === "icon") {
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

              if (name === undefined)
                console.warn("[carbon:icons] Icon name is required");

              if (name !== undefined && name in carbonIcons.icons) {
                const icon = carbonIcons.icons[name as IconName];
                const svgAttributes: Record<string, any> = {};

                Object.entries(defaultIconAttributes).forEach(
                  ([attribute, value]) => {
                    svgAttributes[attribute] = JSON.stringify(value);
                  }
                );

                Object.entries(icon.attributes).forEach(
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

                const markup = `<svg ${attrs}>${icon.children}</svg>`;

                replaceContent(node, markup);
              } else {
                console.warn(`[carbon:icons] invalid icon name "${name}"`);
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
