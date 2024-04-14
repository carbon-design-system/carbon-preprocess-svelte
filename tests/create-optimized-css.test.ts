import { createOptimizedCss } from "../src/plugins/create-optimized-css";

describe("create-optimized-css", () => {
  test("removes unused selectors", () => {
    const result = createOptimizedCss(
      `
        * { box-sizing: border-box }
        a { color: blue }
        button.bx--btn { background-color: red }
        .bx--btn, .bx--btn--primary { color: white }
        .bx--accordion { background-color: yellow }
        .bx--accordion--end, .bx--accordion__content {color: black }
      `,
      ["/Accordion.svelte"],
    );
    expect(result).toMatchSnapshot();
  });

  const font_rules = `
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
    const result = createOptimizedCss(font_rules, ["/Accordion.svelte"]);
    expect(result).toMatchSnapshot();
  });

  test("preserves all IBM fonts", () => {
    const result = createOptimizedCss(font_rules, ["/Accordion.svelte"], {
      preserveAllIBMFonts: true,
    });
    expect(result).toMatchSnapshot();
  });
});
