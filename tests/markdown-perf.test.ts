import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { markdown } from "carbon-preprocess-svelte";
import { renderMarkdown } from "carbon-preprocess-svelte/markdown/compile";
import {
  decodeTokens,
  encodeTokens,
  TOKEN_TYPES,
  tokenize,
} from "carbon-preprocess-svelte/markdown/highlight";
import { imageSize } from "carbon-preprocess-svelte/markdown/image-size";

describe("encodeTokens", () => {
  test("round-trips to the tokenizer's colored ranges", () => {
    const code =
      'import { Button } from "carbon-components-svelte";\nlet count = 0;';
    const ranges = decodeTokens(encodeTokens(code, "js") ?? []);
    let offset = 0;
    const expected = [];
    for (const token of tokenize(code, "js") ?? []) {
      if (token.type && token.text)
        expected.push({
          start: offset,
          end: offset + token.text.length,
          type: token.type,
        });
      offset += token.text.length;
    }
    expect(ranges).toEqual(expected);
    expect(
      ranges.every(
        ({ start, end, type }) => end > start && TOKEN_TYPES.includes(type),
      ),
    ).toBe(true);
    expect(code.slice(ranges[0].start, ranges[0].end)).toBe("import");
  });

  test("leaves out tokens on lines over 1,000 characters", () => {
    const long = `const data = ${JSON.stringify(Array.from({ length: 300 }, (_, i) => i))};`;
    const code = `const a = 1;\n${long}\nconst b = 2;`;
    const ranges = decodeTokens(encodeTokens(code, "js") ?? []);
    const lineOf = (offset: number) => code.slice(0, offset).split("\n").length;
    expect(long.length).toBeGreaterThan(1000);
    expect(ranges.some((r) => lineOf(r.start) === 1)).toBe(true);
    expect(ranges.some((r) => lineOf(r.start) === 2)).toBe(false);
    // Offsets after the long line still line up with the code.
    expect(ranges.slice(-2).map((r) => code.slice(r.start, r.end))).toEqual([
      "2",
      ";",
    ]);
  });

  test("is undefined for a language the tokenizer doesn't know", () => {
    expect(encodeTokens("x", "cobol")).toBeUndefined();
  });
});

/** A PNG header for a `width` × `height` image. */
function png(width: number, height: number): Uint8Array {
  const data = new Uint8Array(33);
  data.set([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
    0x44, 0x52,
  ]);
  const view = new DataView(data.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return data;
}

describe("imageSize", () => {
  test("reads PNG, GIF, JPEG, WebP, and SVG headers", () => {
    expect(imageSize(png(640, 480))).toEqual({ width: 640, height: 480 });
    const gif = new Uint8Array(32);
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x01, 0xc8, 0x00]);
    expect(imageSize(gif)).toEqual({ width: 288, height: 200 });
    const jpeg = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0x00,
      0x04,
      0,
      0,
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      0x01,
      0x2c,
      0x01,
      0x90,
      ...new Array(20).fill(0),
    ]);
    expect(imageSize(jpeg)).toEqual({ width: 400, height: 300 });
    const webp = new Uint8Array(32);
    webp.set(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8X"));
    webp.set([99, 0, 0, 49, 0, 0], 24);
    expect(imageSize(webp)).toEqual({ width: 100, height: 50 });
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 16"><path d="M0 0h32v16H0z"/></svg>',
    );
    expect(imageSize(svg)).toEqual({ width: 32, height: 16 });
    expect(
      imageSize(new TextEncoder().encode('<svg width="24px" height="12">')),
    ).toEqual({ width: 24, height: 12 });
  });

  test("is undefined for other files", () => {
    expect(
      imageSize(
        new TextEncoder().encode(
          "not an image, but long enough to check headers",
        ),
      ),
    ).toBeUndefined();
  });
});

describe("images", () => {
  test("lazy-load every image but the first, and decode asynchronously", async () => {
    const { html } = await renderMarkdown(
      "![Hero](/hero.png)\n\n![Chart](chart.png)\n\n> ![Quoted](q.png)",
    );
    expect(html).toContain(
      '<img src="/hero.png" alt="Hero" decoding="async" />',
    );
    expect(html).toContain(
      '<img src="chart.png" alt="Chart" loading="lazy" decoding="async" />',
    );
    expect(html).toContain(
      '<img src="q.png" alt="Quoted" loading="lazy" decoding="async" />',
    );
  });

  test("leave images as written with `images: false`", async () => {
    const { html } = await renderMarkdown("![A](a.png)", { images: false });
    expect(html).toBe('<p><img src="a.png" alt="A" /></p>');
  });

  test("the preprocessor sizes local images, relative or root-relative", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "md-images-"));
    writeFileSync(path.join(dir, "local.png"), png(120, 80));
    writeFileSync(path.join(dir, "root.png"), png(16, 9));
    const preprocess = markdown({ prose: false, images: { root: dir } });
    const result = await preprocess.markup({
      content:
        "![L](./local.png)\n\n![R](/root.png)\n\n![Remote](https://example.com/x.png)",
      filename: path.join(dir, "page.md"),
    });
    expect(result?.code).toContain(
      '<img src="./local.png" alt="L" decoding="async" width="120" height="80" />',
    );
    expect(result?.code).toContain(
      '<img src="/root.png" alt="R" loading="lazy" decoding="async" width="16" height="9" />',
    );
    expect(result?.code).toContain(
      '<img src="https://example.com/x.png" alt="Remote" loading="lazy" decoding="async" />',
    );
  });
});
