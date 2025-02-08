import { createOptimizedCss } from "carbon-preprocess-svelte/plugins/create-optimized-css";

describe("create-optimized-css", () => {
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

  test("avoids false positives", () => {
    const result = createOptimizedCss({
      source: ".bx--btn, .bx--btn--primary, .bx--unused { color: white }",
      ids: ["Button"],
    });
    expect(result).toEqual(
      ".bx--btn, .bx--btn--primary, .bx--unused { color: white }",
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
