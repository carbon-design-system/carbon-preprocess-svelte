import { createOptimizedCss } from "../src/plugins/create-optimized-css";

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
      ids: ["/Accordion.svelte"],
    });
    expect(result).toEqual(`* { box-sizing: border-box }
a { color: blue }
.bx--accordion { background-color: yellow }
.bx--accordion--end, .bx--accordion__content {color: black }`)
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
}`)
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
}`)
  });
});
