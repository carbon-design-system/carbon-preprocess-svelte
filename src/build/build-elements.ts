import * as elements from "@carbon/elements";
import * as build from "../build";
import { API_ELEMENTS } from "../constants";
import { getPackageJson, writeFile } from "../utils";

export type TokenTypeStyles =
  | build.type.TypeStylesComputed
  | {
      css: string;
      breakpoints: Array<{ mediaQuery: string; css: string }>;
    };

export type TokenUI =
  | "interactive-01"
  | "interactive-02"
  | "interactive-03"
  | "interactive-04"
  | "ui-background"
  | "ui-01"
  | "ui-02"
  | "ui-03"
  | "ui-04"
  | "ui-05"
  | "text-01"
  | "text-02"
  | "text-03"
  | "text-04"
  | "text-05"
  | "text-error"
  | "icon-01"
  | "icon-02"
  | "icon-03"
  | "link-01"
  | "inverse-link"
  | "field-01"
  | "field-02"
  | "inverse-01"
  | "inverse-02"
  | "support-01"
  | "support-02"
  | "support-03"
  | "support-04"
  | "inverse-support-01"
  | "inverse-support-02"
  | "inverse-support-03"
  | "inverse-support-04"
  | "overlay-01"
  | "danger-01"
  | "danger-02"
  | "focus"
  | "inverse-focus-ui"
  | "hover-primary"
  | "active-primary"
  | "hover-primary-text"
  | "hover-secondary"
  | "active-secondary"
  | "hover-tertiary"
  | "active-tertiary"
  | "hover-ui"
  | "hover-light-ui"
  | "hover-selected-ui"
  | "active-ui"
  | "active-light-ui"
  | "selected-ui"
  | "selected-light-ui"
  | "inverse-hover-ui"
  | "hover-danger"
  | "active-danger"
  | "hover-row"
  | "visited-link"
  | "disabled-01"
  | "disabled-02"
  | "disabled-03"
  | "highlight"
  | "decorative-01"
  | "button-separator"
  | "skeleton-01"
  | "skeleton-02"
  | "brand-01"
  | "brand-02"
  | "brand-03"
  | "active-01"
  | "hover-field"
  | "danger";

export type v10_theme = "white" | "g10" | "g90" | "g100";

interface BuildElements extends build.BuildApi {
  tokens: Record<string, string | number | TokenTypeStyles>;
  tokens_ui: Record<TokenUI, Record<v10_theme, any>>;
}

const v10_THEMES: v10_theme[] = ["white", "g10", "g90", "g100"];

(async () => {
  const pkg = getPackageJson("node_modules/@carbon/elements");
  const buildElements: BuildElements = {
    metadata: {
      package: pkg.name!,
      version: pkg.version!,
    },

    tokens: {},

    // @ts-ignore
    tokens_ui: {},
  };

  function addToken(token: string, value?: any) {
    const formatted = elements.formatTokenName(token);
    buildElements.tokens[formatted] = value ?? formatted;
  }

  // colors
  const { colors } = elements;

  Object.entries(colors).forEach(([color, colorMap]) => {
    Object.entries(colorMap).forEach(([grade, hex]) => {
      const name = elements.formatTokenName(color);
      const token = grade === "0" ? name : `${name}-${grade}`;

      buildElements.tokens[token] = hex;
    });
  });

  elements.tokens.type.forEach((type) => {
    const { css, breakpoints } = build.type.serializeTypeStyles(elements[type]);

    buildElements.tokens[elements.formatTokenName(type)] = {
      css,
      breakpoints,
    };
  });

  // UI Colors
  elements.tokens.colors.forEach((color) => {
    addToken(color, undefined);

    const name = elements.formatTokenName(color) as TokenUI;

    buildElements.tokens_ui[name] = {
      white: {},
      g10: {},
      g90: {},
      g100: {},
    };

    v10_THEMES.forEach((theme) => {
      buildElements.tokens_ui[name][theme] = elements[theme][color];
    });
  });

  elements.tokens.layout.forEach((token) => {
    const formatted = elements.formatTokenName(token);
    buildElements.tokens[formatted] = elements[token];
  });

  Object.entries(elements.fontWeights).forEach(([fontWeight, value]) => {
    buildElements.tokens[elements.formatTokenName(fontWeight)] = value;
  });

  Object.entries(elements.fontFamilies).forEach(([fontFamily, value]) => {
    buildElements.tokens[elements.formatTokenName(fontFamily)] = value;
  });

  // motion tokens
  addToken("fast01", elements.fast01);
  addToken("fast02", elements.fast02);
  addToken("moderate01", elements.moderate01);
  addToken("moderate02", elements.moderate02);
  addToken("slow01", elements.slow01);
  addToken("slow02", elements.slow02);

  Object.entries(elements.easings).forEach(([easing, types]) => {
    Object.entries(types).forEach(([type, value]) => {
      const key = `easing.${easing}.${type}`;
      buildElements.tokens[key] = value;
    });
  });

  await writeFile(
    API_ELEMENTS,
    `export const elements = ${JSON.stringify(buildElements, null, 2)}`
  );
})();
