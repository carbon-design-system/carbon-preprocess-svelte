import { createOptimizedCss } from "carbon-preprocess-svelte/plugins/create-optimized-css";

describe("create-optimized-css", () => {
  const strict = { experimental: { strict: true } } as const;

  test("removes unused selectors", () => {
    const result = createOptimizedCss({
      source: `* { box-sizing: border-box }
.empty-rule {}
@media (min-width: 40em) {}
a { color: blue }
button.bx--btn { background-color: red }
.bx--btn, .bx--btn--primary { color: white }
.bx--accordion { background-color: yellow }
.bx--accordion--end, .bx--accordion__content {color: black }`,
      ids: ["Accordion"],
    });
    expect(result).toEqual(`* { box-sizing: border-box }
a { color: blue }
.bx--accordion { background-color: yellow }
.bx--accordion--end, .bx--accordion__content {color: black }`);
  });

  const font_rules = `@font-face {
  font-family: 'CustomFont';
  src: url('path/to/custom-font.ttf');
}
@font-face {
  font-display: auto;
  font-family: IBM Plex Mono;
  font-style: normal;
  font-weight: 400;
}
@font-face {
  font-family: IBM Plex Sans;
  font-style: normal;
  font-weight: 600;
}
@font-face {
  font-family: IBM Plex Sans;
  font-style: normal;
  font-weight: 400;
}
@font-face {
  font-family: IBM Plex Sans;
  font-style: normal;
  font-weight: 300;
}
@font-face {
  font-family: IBM Plex Sans;
  font-style: normal;
  font-weight: 700;
}
@font-face {
  font-family: IBM Plex Sans;
  font-style: italic;
  font-weight: 400;
}
@font-face {
  font-family: IBM Plex Sans;
  font-style: normal;
  font-weight: 100;
}`;

  test("removes unused @font rules", () => {
    const result = createOptimizedCss({
      source: font_rules,
      ids: ["/Accordion.svelte"],
    });
    expect(result).toEqual(`@font-face {
  font-family: 'CustomFont';
  src: url('path/to/custom-font.ttf');
}
@font-face {
  font-display: auto;
  font-family: IBM Plex Mono;
  font-style: normal;
  font-weight: 400;
}
@font-face {
  font-family: IBM Plex Sans;
  font-style: normal;
  font-weight: 600;
}
@font-face {
  font-family: IBM Plex Sans;
  font-style: normal;
  font-weight: 400;
}
@font-face {
  font-family: IBM Plex Sans;
  font-style: normal;
  font-weight: 300;
}`);
  });

  test("preserves all IBM fonts", () => {
    const result = createOptimizedCss({
      source: font_rules,
      ids: ["/Accordion.svelte"],
      preserveAllIBMFonts: true,
    });
    expect(result).toEqual(`@font-face {
  font-family: 'CustomFont';
  src: url('path/to/custom-font.ttf');
}
@font-face {
  font-display: auto;
  font-family: IBM Plex Mono;
  font-style: normal;
  font-weight: 400;
}
@font-face {
  font-family: IBM Plex Sans;
  font-style: normal;
  font-weight: 600;
}
@font-face {
  font-family: IBM Plex Sans;
  font-style: normal;
  font-weight: 400;
}
@font-face {
  font-family: IBM Plex Sans;
  font-style: normal;
  font-weight: 300;
}
@font-face {
  font-family: IBM Plex Sans;
  font-style: normal;
  font-weight: 700;
}
@font-face {
  font-family: IBM Plex Sans;
  font-style: italic;
  font-weight: 400;
}
@font-face {
  font-family: IBM Plex Sans;
  font-style: normal;
  font-weight: 100;
}`);
  });

  test("preserves .bx--body class", () => {
    const result = createOptimizedCss({
      source: ".bx--body { margin: 0 } .bx--unused-class { color: red }",
      ids: [],
    });
    expect(result).toEqual(".bx--body { margin: 0 }");
  });

  test("handles complex selectors with Carbon classes", () => {
    const result = createOptimizedCss({
      source: `a.bx--header { color: blue }
div.bx--unused { background: red }
button.bx--btn.bx--btn--primary { color: white }`,
      ids: ["Header", "Button"],
    });
    expect(result).toEqual(`a.bx--header { color: blue }
button.bx--btn.bx--btn--primary { color: white }`);
  });

  test("preserves mixed selector lists by default", () => {
    const result = createOptimizedCss({
      source: ".bx--btn, .bx--btn--primary, .bx--unused { color: white }",
      ids: ["Button"],
    });
    expect(result).toEqual(
      ".bx--btn, .bx--btn--primary, .bx--unused { color: white }",
    );
  });

  test("removes unused selectors from mixed selector lists in strict mode", () => {
    const result = createOptimizedCss({
      ...strict,
      source: ".bx--btn, .bx--btn--primary, .bx--unused { color: white }",
      ids: ["Button"],
    });
    expect(result).toEqual(".bx--btn, .bx--btn--primary { color: white }");
  });

  test("does not preserve unrelated component skeleton styles in strict mode", () => {
    const result = createOptimizedCss({
      ...strict,
      source: `.bx--btn.bx--skeleton { width: 9rem }
.bx--tabs.bx--skeleton { cursor: default }
.bx--tabs.bx--skeleton .bx--tabs__nav-link span:before { animation: skeleton 3s infinite }
.bx--structured-list.bx--skeleton span { height: 1rem }
.bx--skeleton__text { height: 1rem }
.bx--skeleton { position: relative }`,
      ids: ["Button"],
    });
    expect(result).toEqual(`.bx--btn.bx--skeleton { width: 9rem }
.bx--skeleton { position: relative }`);
  });

  test("drops multi-class selectors with a foreign ancestor in strict mode", () => {
    expect(
      createOptimizedCss({
        ...strict,
        source: ".bx--modal .bx--number { width: 100% }",
        ids: ["NumberInput"],
      }),
    ).toEqual("");

    expect(
      createOptimizedCss({
        ...strict,
        source: ".bx--form--fluid .bx--text-input__field-wrapper { margin: 0 }",
        ids: ["TextInput"],
      }),
    ).toEqual("");

    expect(
      createOptimizedCss({
        ...strict,
        source: ".bx--body--with-modal-open .bx--tooltip { display: none }",
        ids: ["Modal"],
      }),
    ).toEqual("");
  });

  test("does not require classes inside :not() in strict mode", () => {
    const result = createOptimizedCss({
      ...strict,
      source:
        ".bx--header__global button.bx--header__action:not(.bx--header-search-button):hover { color: inherit }",
      ids: ["HeaderGlobalAction"],
    });
    expect(result).toEqual(
      ".bx--header__global button.bx--header__action:not(.bx--header-search-button):hover { color: inherit }",
    );
  });

  test("keeps header global action button hover styles in strict mode", () => {
    const result = createOptimizedCss({
      ...strict,
      source: `.bx--header__global button.bx--header__action.bx--header__action:not(.bx--header-search-button) { color: inherit }
.bx--header__global button.bx--header__action.bx--header__action:not(.bx--header-search-button):hover { background-color: #e5e5e5 }`,
      ids: ["HeaderGlobalAction"],
    });
    expect(
      result,
    ).toEqual(`.bx--header__global button.bx--header__action.bx--header__action:not(.bx--header-search-button) { color: inherit }
.bx--header__global button.bx--header__action.bx--header__action:not(.bx--header-search-button):hover { background-color: #e5e5e5 }`);
  });

  test("keeps multi-class selectors when every class matches in strict mode", () => {
    const result = createOptimizedCss({
      ...strict,
      source: `.bx--modal .bx--number { width: 100% }
.bx--btn.bx--btn--primary { color: white }`,
      ids: ["Modal", "NumberInput", "Button"],
    });
    expect(result).toEqual(`.bx--modal .bx--number { width: 100% }
.bx--btn.bx--btn--primary { color: white }`);
  });

  test("preserves selectors for explicit skeleton components", () => {
    const result = createOptimizedCss({
      ...strict,
      source: `.bx--skeleton__text { height: 1rem }
.bx--skeleton__heading { height: 1.5rem }
.bx--skeleton__placeholder { width: 100% }
.bx--tabs.bx--skeleton { cursor: default }`,
      ids: ["SkeletonText"],
    });
    expect(result).toEqual(`.bx--skeleton__text { height: 1rem }
.bx--skeleton__heading { height: 1.5rem }`);
  });

  test("keeps non-Carbon selectors when pruning mixed selector lists", () => {
    const result = createOptimizedCss({
      ...strict,
      source: "button, .bx--unused { color: red }",
      ids: ["Button"],
    });
    expect(result).toEqual("button { color: red }");
  });

  test("preserves flatpickr selectors by default", () => {
    const source = `.flatpickr-calendar { visibility: hidden }
.numInputWrapper:hover { background-color: #353535 }`;

    expect(createOptimizedCss({ source, ids: ["Button"] })).toEqual(source);
  });

  test("removes flatpickr selectors unless DatePicker is used in strict mode", () => {
    const result = createOptimizedCss({
      ...strict,
      source: `@keyframes fpFadeInDown { from { opacity: 0 } to { opacity: 1 } }
.flatpickr-calendar { visibility: hidden }
.flatpickr-calendar.open, .flatpickr-calendar.inline { visibility: inherit }
.numInputWrapper:hover { background-color: #353535 }
.flatpickr-current-month .cur-month { margin: 0 .25rem }
button, .flatpickr-day.selected { color: red }`,
      ids: ["Button"],
    });
    expect(result).toEqual("button { color: red }");
  });

  test("preserves flatpickr selectors when DatePicker is used", () => {
    const result = createOptimizedCss({
      ...strict,
      source: `@keyframes fpFadeInDown { from { opacity: 0 } to { opacity: 1 } }
.flatpickr-calendar { visibility: hidden }
.numInputWrapper:hover { background-color: #353535 }
.flatpickr-current-month .cur-month { margin: 0 .25rem }`,
      ids: ["DatePicker"],
    });
    expect(
      result,
    ).toEqual(`@keyframes fpFadeInDown { from { opacity: 0 } to { opacity: 1 } }
.flatpickr-calendar { visibility: hidden }
.numInputWrapper:hover { background-color: #353535 }
.flatpickr-current-month .cur-month { margin: 0 .25rem }`);
  });

  test("matches legacy single-hyphen Carbon selectors against the allowlist", () => {
    const source = `.bx-slider-text-input { appearance: textfield }
.bx-slider-text-input::-webkit-outer-spin-button { display: none }
.bx-slider-text-input::-webkit-inner-spin-button { display: none }`;

    expect(createOptimizedCss({ source, ids: ["Button"] })).toEqual(source);
    expect(createOptimizedCss({ ...strict, source, ids: ["Button"] })).toEqual(
      "",
    );
    expect(createOptimizedCss({ ...strict, source, ids: ["Slider"] })).toEqual(
      source,
    );
  });

  test("ignores non-Carbon prefixed rules", () => {
    const result = createOptimizedCss({
      source: ".custom-class { color: red }",
      ids: ["Button"],
    });
    expect(result).toEqual(".custom-class { color: red }");
  });
});
