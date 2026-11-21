import { createCarbonStylePruner } from "../src/plugins/carbon-style-pruner";

const analyzer = await import("svelte-prune/internal/analysis");

/** Prunes `css` as if only `live` components render and only `rendered` classes apply. */
function prune(
  css: string,
  {
    live = [] as string[],
    rendered = [] as string[],
    preserveAllIBMFonts = false,
  } = {},
) {
  const pruner = createCarbonStylePruner({
    analyzer,
    root: process.cwd(),
    isPruned: (cls) => !rendered.includes(cls),
    loadable: () => false,
    liveComponents: new Set(live),
    files: [],
    safelist: [],
    preserveAllIBMFonts,
  });
  if (!pruner) throw new Error("no pruner");
  return pruner(css).css;
}

describe("createCarbonStylePruner", () => {
  test("removes what nothing renders, keeps what does", () => {
    const css = prune(".bx--btn{a:1}.bx--btn--danger{a:2}", {
      rendered: [".bx--btn"],
    });
    expect(css).toContain(".bx--btn{");
    expect(css).not.toContain("danger");
  });

  test("keeps the classes apps set themselves, and context ancestors", () => {
    const css = prune(
      ".bx--body{a:1}.bx--header__global .bx--header__action{a:2}",
      { rendered: [".bx--header__action"] },
    );
    expect(css).toContain(".bx--body");
    expect(css).toContain(".bx--header__global .bx--header__action");
  });

  test("keeps flatpickr's rules only with a DatePicker", () => {
    const source =
      ".flatpickr-calendar{a:1}.flatpickr-calendar.open{animation:fpFadeInDown .3s}.dayContainer{a:2}@keyframes fpFadeInDown{to{opacity:1}}";
    expect(prune(source)).not.toContain("flatpickr");
    expect(prune(source)).not.toContain("fpFadeInDown");
    const kept = prune(source, { live: ["DatePicker"] });
    expect(kept).toContain(".flatpickr-calendar");
    expect(kept).toContain(".dayContainer");
    expect(kept).toContain("fpFadeInDown");
  });

  test("removes a legacy `bx-` selector whose `bx--` class can't render", () => {
    const css = prune(".bx-btn,.bx--btn{a:1}.bx-tag{a:2}", {
      rendered: [".bx--btn"],
    });
    expect(css).toContain(".bx-btn");
    expect(css).not.toContain(".bx-tag");
  });

  test("keeps only the IBM Plex faces Carbon uses", () => {
    const face = (family: string, weight: string, style = "normal") =>
      `@font-face{font-family:${family};font-style:${style};font-weight:${weight};src:local(x)}`;
    const source = [
      face("IBM Plex Sans", "400"),
      face("IBM Plex Sans", "700"),
      face("IBM Plex Sans", "400", "italic"),
      face("IBM Plex Mono", "400"),
      face("IBM Plex Serif", "400"),
    ].join("");
    const css = prune(source);
    expect(css).toContain("IBM Plex Sans;font-style:normal;font-weight:400");
    expect(css).not.toContain("font-weight:700");
    expect(css).not.toContain("italic");
    expect(css).toContain("IBM Plex Mono");
    expect(css).toContain("IBM Plex Serif");
    // `<Text italic>` renders `.bx--type-italic`.
    expect(prune(source, { rendered: [".bx--type-italic"] })).toContain(
      "italic",
    );
    expect(prune(source, { preserveAllIBMFonts: true })).toContain(
      "font-weight:700",
    );
  });
});
