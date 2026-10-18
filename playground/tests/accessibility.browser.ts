// Accessibility: axe on the code views, and the contrast of what axe can't
// see (colors painted with the CSS Custom Highlight API, ANSI output).
import path from "node:path";
import { open, useBrowser } from "./helpers";

const context = useBrowser();
const AXE = path.join(
  import.meta.dirname,
  "../node_modules/axe-core/axe.min.js",
);

/** WCAG contrast helpers for the page: `__rgb(css)` and `__ratio(a, b)`. */
const CONTRAST = `
  const canvas = Object.assign(document.createElement("canvas"), { width: 1, height: 1 });
  const g = canvas.getContext("2d", { willReadFrequently: true });
  const rgb = (css) => { g.clearRect(0, 0, 1, 1); g.fillStyle = "#000"; g.fillStyle = css; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
  const lum = ([r, gg, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  window.__rgb = rgb;
  window.__ratio = ratio;
`;

describe("accessibility", () => {
  for (const theme of ["white", "g100"]) {
    test(`axe finds no violations in the code views (${theme})`, async () => {
      const { page } = await open(
        context(),
        `page=KitchenSink&theme=${theme}&lazy=0`,
      );
      await page.addScriptTag({ path: AXE });
      const result = await page.evaluate(() =>
        window.axe.run(
          { include: [[".codeview"]] },
          { resultTypes: ["violations"] },
        ),
      );
      expect(
        result.violations.map(
          (v: { id: string; nodes: unknown[] }) =>
            `${v.id} (${v.nodes.length})`,
        ),
      ).toEqual([]);
      await page.close();
    });
  }

  // g90's plain syntax colors are Carbon's own (below 4.5:1 for a few tokens),
  // so the themes here are the ones the line bands and ANSI colors must hold in.
  for (const theme of ["white", "g10", "g100"]) {
    test(`syntax colors keep 4.5:1 on every line band, and ANSI colors on the background (${theme})`, async () => {
      const { page } = await open(context(), `page=KitchenSink&theme=${theme}`);
      await page.addScriptTag({ content: CONTRAST });
      const lowest = await page.evaluate(() => {
        const rgb = window.__rgb;
        const ratio = window.__ratio;
        const region = document.createElement("div");
        region.className = "codeview";
        document.body.append(region);
        const probe = document.createElement("span");
        region.append(probe);
        const v = (name: string) =>
          getComputedStyle(region).getPropertyValue(name).trim();
        const bg = rgb(v("--cds-ui-01"));
        const base = rgb(v("--code-band-base"));
        const mix = (top: number[], bottom: number[], a: number) =>
          top.map((c, i) => Math.round(c * a + bottom[i] * (1 - a)));
        const names = [...document.styleSheets]
          .flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText))
          .flatMap((css) =>
            [
              ...css.matchAll(/::highlight\(syntax-([\w-]+)\)\s*\{\s*color:/g),
            ].map((m) => m[1]),
          );
        let syntax = Infinity;
        for (const name of names) {
          const fg = rgb(v(`--cds-syntax-${name}`));
          for (const accent of [
            "--cds-interactive-04",
            "--cds-support-01",
            "--cds-support-02",
            "--cds-support-03",
          ]) {
            syntax = Math.min(
              syntax,
              ratio(fg, mix(rgb(v(accent)), base, 0.06)),
            );
          }
        }
        let ansi = Infinity;
        for (const color of [
          "black",
          "red",
          "green",
          "yellow",
          "blue",
          "magenta",
          "cyan",
          "white",
        ]) {
          probe.className = `ansi-${color}`;
          ansi = Math.min(ansi, ratio(rgb(getComputedStyle(probe).color), bg));
        }
        for (let h = 0; h < 360; h += 30) {
          probe.className = "ansi-rgb";
          probe.style.setProperty("--ansi-fg", `hsl(${h} 100% 50%)`);
          ansi = Math.min(ansi, ratio(rgb(getComputedStyle(probe).color), bg));
        }
        region.remove();
        return { syntax, ansi, tokens: names.length };
      });
      expect(lowest.tokens).toBeGreaterThan(20);
      expect(lowest.syntax).toBeGreaterThanOrEqual(4.5);
      expect(lowest.ansi).toBeGreaterThanOrEqual(4.5);
      await page.close();
    });
  }
});
