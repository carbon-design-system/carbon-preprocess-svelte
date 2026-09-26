import {
  createCssOptimizer,
  createOptimizedCss,
  optimizeCssWithReport,
} from "carbon-preprocess-svelte/plugins/create-optimized-css";
import { components } from "./helpers/component-index";

const BTN_VARIANT_RE = /^\.bx--btn--/;

describe("create-optimized-css", () => {
  test("removes unused selectors", () => {
    const result = createOptimizedCss({
      components,
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
  font-style: italic;
  font-weight: 700;
}
@font-face {
  font-family: IBM Plex Sans;
  font-style: normal;
  font-weight: 100;
}`;

  test("removes unused @font rules", () => {
    const result = createOptimizedCss({
      components,
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

  test("keeps IBM Plex Sans italic faces for `<Text italic>`", () => {
    const result = createOptimizedCss({
      components,
      source: font_rules,
      ids: ["/Text.svelte"],
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
  font-style: italic;
  font-weight: 400;
}`);
  });

  test("preserves all IBM fonts", () => {
    const result = createOptimizedCss({
      components,
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
  font-style: italic;
  font-weight: 700;
}
@font-face {
  font-family: IBM Plex Sans;
  font-style: normal;
  font-weight: 100;
}`);
  });

  test("preserves .bx--body class", () => {
    const result = createOptimizedCss({
      components,
      source: ".bx--body { margin: 0 } .bx--unused-class { color: red }",
      ids: [],
    });
    expect(result).toEqual(".bx--body { margin: 0 }");
  });

  test("handles complex selectors with Carbon classes", () => {
    const result = createOptimizedCss({
      components,
      source: `a.bx--header { color: blue }
div.bx--unused { background: red }
button.bx--btn.bx--btn--primary { color: white }`,
      ids: ["Header", "Button"],
    });
    expect(result).toEqual(`a.bx--header { color: blue }
button.bx--btn.bx--btn--primary { color: white }`);
  });

  test("removes unused selectors from mixed selector lists", () => {
    const result = createOptimizedCss({
      components,
      source: ".bx--btn, .bx--btn--primary, .bx--unused { color: white }",
      ids: ["Button"],
    });
    expect(result).toEqual(".bx--btn, .bx--btn--primary { color: white }");
  });

  test("does not preserve unrelated component skeleton styles", () => {
    const result = createOptimizedCss({
      components,
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

  test("drops multi-class selectors with a foreign ancestor", () => {
    expect(
      createOptimizedCss({
        components,
        source: ".bx--modal .bx--number { width: 100% }",
        ids: ["NumberInput"],
      }),
    ).toEqual("");

    expect(
      createOptimizedCss({
        components,
        source: ".bx--form--fluid .bx--text-input__field-wrapper { margin: 0 }",
        ids: ["TextInput"],
      }),
    ).toEqual("");

    expect(
      createOptimizedCss({
        components,
        source: ".bx--body--with-modal-open .bx--tooltip { display: none }",
        ids: ["Modal"],
      }),
    ).toEqual("");
  });

  test("does not require classes inside :not()", () => {
    const result = createOptimizedCss({
      components,
      source:
        ".bx--header__global button.bx--header__action:not(.bx--header-search-button):hover { color: inherit }",
      ids: ["HeaderGlobalAction"],
    });
    expect(result).toEqual(
      ".bx--header__global button.bx--header__action:not(.bx--header-search-button):hover { color: inherit }",
    );
  });

  test("exempts context ancestors but drops foreign subjects", () => {
    expect(
      createOptimizedCss({
        components,
        source: ".bx--body--with-modal-open .bx--tooltip { display: none }",
        ids: ["Modal"],
      }),
    ).toEqual("");

    expect(
      createOptimizedCss({
        components,
        source: ".bx--form--fluid .bx--text-input { margin: 0 }",
        ids: ["TextInput"],
      }),
    ).toEqual("");
  });

  test("keeps descendant selectors when context ancestor is exempt", () => {
    const result = createOptimizedCss({
      components,
      source:
        ".bx--header__global button.bx--header__action { color: inherit }",
      ids: ["HeaderGlobalAction"],
    });
    expect(result).toEqual(
      ".bx--header__global button.bx--header__action { color: inherit }",
    );
  });

  test("keeps header global action button hover styles", () => {
    const result = createOptimizedCss({
      components,
      source: `.bx--header__global button.bx--header__action.bx--header__action:not(.bx--header-search-button) { color: inherit }
.bx--header__global button.bx--header__action.bx--header__action:not(.bx--header-search-button):hover { background-color: #e5e5e5 }`,
      ids: ["HeaderGlobalAction"],
    });
    expect(
      result,
    ).toEqual(`.bx--header__global button.bx--header__action.bx--header__action:not(.bx--header-search-button) { color: inherit }
.bx--header__global button.bx--header__action.bx--header__action:not(.bx--header-search-button):hover { background-color: #e5e5e5 }`);
  });

  test("keeps multi-class selectors when every class matches", () => {
    const result = createOptimizedCss({
      components,
      source: `.bx--modal .bx--number { width: 100% }
.bx--btn.bx--btn--primary { color: white }`,
      ids: ["Modal", "NumberInput", "Button"],
    });
    expect(result).toEqual(`.bx--modal .bx--number { width: 100% }
.bx--btn.bx--btn--primary { color: white }`);
  });

  test("preserves selectors for explicit skeleton components", () => {
    const result = createOptimizedCss({
      components,
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
      components,
      source: "button, .bx--unused { color: red }",
      ids: ["Button"],
    });
    expect(result).toEqual("button { color: red }");
  });

  test("removes flatpickr selectors unless DatePicker is used", () => {
    const result = createOptimizedCss({
      components,
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
      components,
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

    expect(createOptimizedCss({ components, source, ids: ["Button"] })).toEqual(
      "",
    );
    expect(createOptimizedCss({ components, source, ids: ["Slider"] })).toEqual(
      source,
    );
  });

  test("ignores non-Carbon prefixed rules", () => {
    const result = createOptimizedCss({
      components,
      source: ".custom-class { color: red }",
      ids: ["Button"],
    });
    expect(result).toEqual(".custom-class { color: red }");
  });

  describe("safelist", () => {
    const grid = ".bx--grid { display: grid }";

    test("prunes a hand-written bx--grid rule when not safelisted", () => {
      expect(
        createOptimizedCss({ components, source: grid, ids: ["Button"] }),
      ).toEqual("");
    });

    test("keeps a safelisted bx--grid rule (string entry)", () => {
      const safelist = [".bx--grid"];
      expect(
        createOptimizedCss({
          components,
          source: grid,
          ids: ["Button"],
          safelist,
        }),
      ).toEqual(grid);
    });

    test("string entry matches a class token, not a prefix", () => {
      const source = ".bx--grid { display: grid }\n.bx--grid-narrow { gap: 0 }";
      expect(
        createOptimizedCss({
          components,
          source,
          ids: ["Button"],
          safelist: [".bx--grid"],
        }),
      ).toEqual(".bx--grid { display: grid }");
    });

    test("RegExp entry keeps every matching selector", () => {
      const source =
        ".bx--btn--primary { color: white }\n.bx--btn--secondary { color: gray }";
      expect(
        createOptimizedCss({
          components,
          source,
          ids: ["Accordion"],
          safelist: [BTN_VARIANT_RE],
        }),
      ).toEqual(source);
    });

    test("keeps only the matching selector in a comma list", () => {
      const source = ".bx--grid, .bx--unused { display: grid }";
      expect(
        createOptimizedCss({
          components,
          source,
          ids: ["Button"],
          safelist: [".bx--grid"],
        }),
      ).toEqual(".bx--grid { display: grid }");
    });

    test("keeps a safelisted flatpickr selector", () => {
      const source = ".flatpickr-calendar { visibility: hidden }";
      expect(
        createOptimizedCss({
          components,
          source,
          ids: ["Button"],
          safelist: [".flatpickr-calendar"],
        }),
      ).toEqual(source);
    });
  });

  describe("content (scanned classes)", () => {
    test("keeps dynamic class variants from a scanned prefix", () => {
      const source = ".bx--btn--ghost { color: blue }";
      expect(
        createOptimizedCss({ components, source, ids: ["Accordion"] }),
      ).toEqual("");
      expect(
        createOptimizedCss({
          components,
          source,
          ids: ["Accordion"],
          contentClasses: [".bx--btn--"],
        }),
      ).toEqual(source);
    });
  });

  describe("optimizeCssWithReport", () => {
    test("counts pruned Carbon rules", () => {
      const { css, removed } = optimizeCssWithReport({
        components,
        source: `.bx--btn { color: blue }
.bx--accordion { background: yellow }`,
        ids: ["Button"],
      });
      expect(removed).toBe(1);
      expect(css).toEqual(".bx--btn { color: blue }");
    });

    test("reports zero when nothing is pruned", () => {
      const source = ".bx--btn { color: blue }\n.custom { color: red }";
      const { css, removed } = optimizeCssWithReport({
        components,
        source,
        ids: ["Button"],
      });
      expect(removed).toBe(0);
      expect(css).toEqual(source);
    });

    test("counts removed @font-face rules", () => {
      const { removed } = optimizeCssWithReport({
        components,
        source: `@font-face {
  font-family: IBM Plex Sans;
  font-style: normal;
  font-weight: 700;
}`,
        ids: ["/Accordion.svelte"],
      });
      expect(removed).toBe(1);
    });

    test("counts selectors pruned from a comma list", () => {
      const { css, removed } = optimizeCssWithReport({
        components,
        source: ".bx--btn, .bx--accordion { color: white }",
        ids: ["Button"],
      });
      expect(removed).toBe(1);
      expect(css).toEqual(".bx--btn { color: white }");
    });
  });

  describe("usage", () => {
    test("reports the de-duplicated, sorted list of matched components", () => {
      const { usage } = createCssOptimizer({
        components,
        ids: [
          "/x/Button.svelte",
          "/x/Button.svelte",
          "/x/NotAComponent.svelte",
        ],
      });

      expect(usage.components).toEqual(["Button"]);
      expect(usage.allowlistSize).toBeGreaterThan(0);
    });
  });

  describe("class variants", () => {
    const source = [
      ".bx--btn--primary{a:b}",
      ".bx--btn--secondary{a:b}",
      ".bx--btn--danger{a:b}",
      ".bx--btn--ghost{a:b}",
      ".bx--btn--icon-only--bottom.bx--tooltip--align-center{a:b}",
      ".bx--btn--icon-only--top.bx--tooltip--align-end{a:b}",
      ".bx--btn--icon-only--left.bx--tooltip--align-start{a:b}",
    ].join("");

    const propUsage = (
      literals: Record<string, string[]>,
      dynamic: string[] = [],
    ) => ({
      literals: new Map(
        Object.entries(literals).map(([prop, values]) => [
          prop,
          new Set(values),
        ]),
      ),
      dynamic: new Set(dynamic),
    });

    test("keeps every variant without prop usage", () => {
      expect(
        createOptimizedCss({ components, source, ids: ["Button"] }),
      ).toEqual(source);
    });

    test("keeps each prop's default plus the literals the app passes", () => {
      const optimizer = createCssOptimizer({
        components,
        ids: ["Button"],
        propUsage: propUsage({
          kind: ["danger"],
          tooltipPosition: ["top"],
          tooltipAlignment: ["end"],
        }),
      });

      expect(optimizer.run(source).css).toEqual(
        [
          ".bx--btn--primary{a:b}",
          ".bx--btn--danger{a:b}",
          ".bx--btn--icon-only--bottom.bx--tooltip--align-center{a:b}",
          ".bx--btn--icon-only--top.bx--tooltip--align-end{a:b}",
        ].join(""),
      );
      expect(optimizer.usage.variants).toEqual([
        { component: "Button", prop: "kind", values: ["primary", "danger"] },
        {
          component: "Button",
          prop: "tooltipPosition",
          values: ["bottom", "top"],
        },
        {
          component: "Button",
          prop: "tooltipAlignment",
          values: ["center", "end"],
        },
      ]);
    });

    test("a prop passed a dynamic value keeps all of its variants", () => {
      const optimizer = createCssOptimizer({
        components,
        ids: ["Button"],
        propUsage: propUsage({}, ["kind"]),
      });
      const css = optimizer.run(source).css;

      expect(css).toContain(".bx--btn--secondary{a:b}");
      expect(css).toContain(".bx--btn--ghost{a:b}");
      expect(css).not.toContain(".bx--btn--icon-only--left");
      expect(optimizer.usage.variants[0]).toEqual({
        component: "Button",
        prop: "kind",
        values: null,
      });
    });

    test("a bundled parent that renders the prefix keeps it whole", () => {
      // Pagination renders `<Button kind="ghost" tooltipPosition={…}>`.
      const optimizer = createCssOptimizer({
        components,
        ids: ["Button", "Pagination"],
        propUsage: propUsage({}),
      });

      expect(optimizer.run(source).css).toContain(".bx--btn--secondary{a:b}");
      expect(
        optimizer.usage.variants.find((variant) => variant.prop === "kind"),
      ).toEqual({ component: "Button", prop: "kind", values: null });
    });
  });

  describe("class gates", () => {
    const tag = {
      path: "carbon-components-svelte/src/Tag/Tag.svelte",
      classes: [
        ".bx--tag",
        ".bx--tag--filter",
        ".bx--tag--red",
        ".bx--tag--sm",
      ],
      gates: [
        {
          class: ".bx--tag--filter",
          when: [[{ prop: "filter", default: false }]],
        },
        {
          class: ".bx--tag--red",
          when: [[{ prop: "type", default: null, equals: "red" }]],
        },
        {
          class: ".bx--tag--sm",
          when: [[{ prop: "size", default: "sm", equals: "sm" }]],
        },
      ],
    };
    const source =
      ".bx--tag{a:b}.bx--tag--filter{a:b}.bx--tag--red{a:b}.bx--tag--sm{a:b}.bx--tag--blue{a:b}";
    const usage = (
      literals: Record<string, string[]>,
      dynamic: string[] = [],
    ) => ({
      literals: new Map(
        Object.entries(literals).map(([prop, values]) => [
          prop,
          new Set(values),
        ]),
      ),
      dynamic: new Set(dynamic),
    });
    const run = (propUsage?: ReturnType<typeof usage>, extra = {}) =>
      createCssOptimizer({
        components: { Tag: tag, ...extra },
        ids: ["Tag", ...Object.keys(extra)],
        propUsage,
      });

    test("keeps gated classes without prop usage", () => {
      // `.bx--tag--blue` rides on the unshared `.bx--tag` BEM parent.
      expect(run().run(source).css).toEqual(source);
    });

    test("drops classes no condition can reach, overriding the BEM parent", () => {
      const optimizer = run(usage({}));
      expect(optimizer.run(source).css).toEqual(
        ".bx--tag{a:b}.bx--tag--sm{a:b}.bx--tag--blue{a:b}",
      );
      expect(optimizer.usage.gatedOff).toEqual([
        { component: "Tag", classes: [".bx--tag--filter", ".bx--tag--red"] },
      ]);
    });

    test("a literal or a dynamic prop keeps the class", () => {
      expect(
        run(usage({ filter: ["true"] }, ["type"])).run(source).css,
      ).toEqual(source);
    });

    test("another component rendering the class keeps it", () => {
      const badge = {
        path: "carbon-components-svelte/src/Badge/Badge.svelte",
        classes: [".bx--tag--red"],
      };
      expect(run(usage({}), { Badge: badge }).run(source).css).toContain(
        ".bx--tag--red{a:b}",
      );
    });
  });
});
