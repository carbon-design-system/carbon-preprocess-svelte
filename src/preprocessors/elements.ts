import { PreprocessorGroup } from "svelte/types/compiler/preprocess";
import {
  rgba,
  rem,
  em,
  px,
  breakpoint,
  breakpointDown,
  breakpointUp,
  breakpoints,
  BreakpointName,
} from "@carbon/elements";
import { TokenTypeStyles, TokenUI, v10_theme } from "../build/build-elements";
import { MediaFeature, walkAndReplace } from "../walk-and-replace";
import * as carbonElements from "../carbon-elements";

interface PreprocessElementsOptions {
  /**
   * Specify the Carbon theme
   * Setting to "all" will also enable `cssVars`
   * @default "white"
   */
  theme: v10_theme | "all";

  /**
   * Set to `true` for tokens to be re-written as CSS variables
   * Automatically set to `true` if theme is "all"
   * @example
   * "spacing-05" --> var(--cds-spacing-05)
   * "ui-01" --> var(--cds-ui-01)
   * @default false
   */
  cssVars: boolean;
}

export type ElementsOptions = Partial<PreprocessElementsOptions>;

type Token = keyof typeof carbonElements.elements.tokens;

const PROPERTY_ALIAS = {
  font: "font",
};

const TOKEN_TYPE = {
  font: "font",
};

const BREAKPOINTS = Object.keys(breakpoints);

function getMediaFeatureValue(feature: MediaFeature) {
  if (feature.value == null) {
    if (BREAKPOINTS.includes(feature.name)) {
      return breakpoints[feature.name as BreakpointName].width;
    } else {
      console.warn(
        `[carbon:elements] Invalid breakpoint name "${feature.name}"`
      );

      return null;
    }
  }

  if ("unit" in feature.value) {
    return feature.value.value + feature.value.unit;
  }
}

export function elements(
  options?: ElementsOptions
): Pick<PreprocessorGroup, "style"> {
  const theme = options?.theme ?? "white";
  const cssVars = options?.cssVars === true || theme === "all";

  return {
    style({ filename, content }) {
      if (filename && !/node_modules/.test(filename)) {
        const code = walkAndReplace(
          { type: "style", content, filename },
          ({ node }, replaceContent, getContent) => {
            if (node.type === "Rule") {
              node.block.children.forEach((child) => {
                let operator: string | undefined = undefined;
                let operatorValue: string | undefined = undefined;

                const hasOperator = child.value.children.some(
                  (child, index) => index > 0 && child.type === "Operator"
                );

                if (hasOperator) {
                  operator = child.value.children.find(
                    (child) => child.type === "Operator"
                  )!.value;

                  operatorValue = child.value.children.find(
                    (child) => child.type === "Number"
                  )?.value;
                }

                const Value = child.value.children
                  .map((childValue) => {
                    if (childValue.type === "String") {
                      const token = childValue.value.replace(/(\"|\')/g, "");

                      if (
                        token !== undefined &&
                        token in carbonElements.elements.tokens
                      ) {
                        const tokenValue =
                          carbonElements.elements.tokens[token as Token];
                        if (child.property in TOKEN_TYPE) {
                          if (
                            (tokenValue as TokenTypeStyles).breakpoints.length >
                            0
                          ) {
                            // TODO: generate responsive styles
                          }

                          replaceContent(
                            node,
                            (tokenValue as TokenTypeStyles).css,
                            getContent(child)
                          );

                          return (tokenValue as TokenTypeStyles).css;
                        }

                        if (token in carbonElements.elements.tokens_ui) {
                          let Value: TokenUI | string;

                          if (theme === "all" || cssVars)
                            Value = `var(--cds-${token})`;
                          else
                            Value =
                              carbonElements.elements.tokens_ui[
                                token as TokenUI
                              ][theme];

                          replaceContent(
                            node,
                            `${child.property}: ${Value}`,
                            getContent(child)
                          );

                          if (theme === "all") return `var(--cds-${token})`;
                          return carbonElements.elements.tokens_ui[
                            token as TokenUI
                          ][theme];
                        }

                        const oldValue = getContent(child.value);

                        let newValue = oldValue.replace(
                          childValue.value,
                          tokenValue as string
                        );

                        if (hasOperator && operatorValue !== undefined) {
                          newValue = `calc(${tokenValue} ${operator} ${operatorValue})`;
                        }

                        replaceContent(
                          node,
                          `${child.property}: ${newValue}`,
                          getContent(child)
                        );

                        return tokenValue;
                      } else {
                        console.warn(
                          `[carbon:elements] Invalid token "${token}"`
                        );
                      }
                    }

                    return getContent(childValue);
                  })
                  .join(" ");

                if (child.property in PROPERTY_ALIAS) return Value;

                return `${child.property}: ${Value};`;
              });
            }

            if (node.type === "Atrule" && node.name === "media") {
              const mediaFeatures: MediaFeature[] = [];

              node.prelude.children
                .flatMap((child) => child.children ?? [])
                .forEach((node) => {
                  node.children.forEach((child) => {
                    if (child.type === "MediaFeature") {
                      mediaFeatures.push(child);
                    }
                  });
                });

              if (mediaFeatures.length === 1) {
                const { name, value } = mediaFeatures[0];

                let featureValue: string = "";

                if (value != null && "name" in value) {
                  featureValue = value.name;
                }

                if (BREAKPOINTS.includes(featureValue)) {
                  switch (name) {
                    case "up":
                      replaceContent(
                        node,
                        `${breakpointUp(
                          featureValue as BreakpointName
                        )} ${getContent(node.block)}`
                      );
                      break;
                    case "down":
                      replaceContent(
                        node,
                        `${breakpointDown(
                          featureValue as BreakpointName
                        )} ${getContent(node.block)}`
                      );
                      break;
                    case "bp":
                      replaceContent(
                        node,
                        `${breakpoint(
                          featureValue as BreakpointName
                        )} ${getContent(node.block)}`
                      );
                      break;
                  }
                } else {
                  console.warn(
                    `[carbon:elements] Invalid breakpoint name "${name}"`
                  );
                }
              } else {
                const firstValue = getMediaFeatureValue(mediaFeatures[0]);
                const secondValue = getMediaFeatureValue(mediaFeatures[1]);

                if (firstValue && secondValue) {
                  replaceContent(
                    node,
                    `@media (min-width: ${firstValue}) and (max-width: ${secondValue}) ${getContent(
                      node.block
                    )}`
                  );
                }
              }
            }

            if (node.type === "Function") {
              if (node.name === "rgba") {
                const [hex, operator, number] = node.children;

                if (hex.value.length < 6) {
                  console.warn(
                    `[carbon:elements] rgba hex value must be six characters. Received "#${hex.value}"`
                  );
                  return;
                }

                let opacity = 1;

                if (number !== undefined) {
                  opacity = Number(number.value);

                  if (opacity > 1) {
                    console.warn(
                      `[carbon:elements] rgba opacity value cannot be greater than 1. Received ${opacity}`
                    );
                    opacity = 1;
                  }

                  if (opacity < 0) {
                    console.warn(
                      `[carbon:elements] rgba opacity value cannot be less than 0. Received ${opacity}`
                    );
                    opacity = 0;
                  }
                }

                replaceContent(node, rgba(hex.value, opacity));
              }

              if (node.name === "rem") {
                const dimension = node.children[0];
                const px = Number(dimension?.value ?? 0);

                replaceContent(node, rem(px));
              }

              if (node.name === "em") {
                const dimension = node.children[0];
                const px = Number(dimension?.value ?? 0);

                replaceContent(node, em(px));
              }

              if (node.name === "px") {
                const dimension = node.children[0];
                const value = Number(dimension?.value ?? 0);

                replaceContent(node, px(value));
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
