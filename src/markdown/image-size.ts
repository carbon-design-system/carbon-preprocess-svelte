/**
 * Intrinsic size of an image file, from its header: PNG, GIF, JPEG, WebP,
 * and SVG (`width`/`height`, else `viewBox`). Enough for `width` and
 * `height` attributes, which let the browser reserve an image's space before
 * it loads.
 */
export interface ImageSize {
  width: number;
  height: number;
}

const SVG_ROOT = /<svg\b[^>]*>/i;
const SVG_LENGTH = /^\s*([\d.]+)(px)?\s*$/;
const LIST_SEPARATOR = /[\s,]+/;

function svgAttribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
}

function svgSize(text: string): ImageSize | undefined {
  const tag = SVG_ROOT.exec(text)?.[0];
  if (!tag) return undefined;
  const width = SVG_LENGTH.exec(svgAttribute(tag, "width") ?? "")?.[1];
  const height = SVG_LENGTH.exec(svgAttribute(tag, "height") ?? "")?.[1];
  if (width && height) return { width: Number(width), height: Number(height) };
  const box = svgAttribute(tag, "viewBox")
    ?.trim()
    .split(LIST_SEPARATOR)
    .map(Number);
  if (box?.length === 4 && box[2] > 0 && box[3] > 0) {
    return { width: box[2], height: box[3] };
  }
  return undefined;
}

function jpegSize(data: Uint8Array, view: DataView): ImageSize | undefined {
  let i = 2;
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) return undefined;
    const marker = data[i + 1];
    // Start-of-frame markers, except DHT (C4), JPG (C8), and DAC (CC).
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
    }
    i += 2 + view.getUint16(i + 2);
  }
  return undefined;
}

function webpSize(data: Uint8Array, view: DataView): ImageSize | undefined {
  const chunk = String.fromCharCode(...data.subarray(12, 16));
  if (chunk === "VP8 ") {
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    const width = 1 + (data[24] | (data[25] << 8) | (data[26] << 16));
    const height = 1 + (data[27] | (data[28] << 8) | (data[29] << 16));
    return { width, height };
  }
  return undefined;
}

/** The size of an image file's contents, or `undefined` if unrecognized. */
export function imageSize(data: Uint8Array): ImageSize | undefined {
  if (data.length < 30) {
    return svgSize(new TextDecoder().decode(data));
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // PNG: the IHDR chunk follows the 8-byte signature.
  if (view.getUint32(0) === 0x89504e47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // GIF87a / GIF89a
  if (view.getUint32(0) === 0x47494638) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (data[0] === 0xff && data[1] === 0xd8) return jpegSize(data, view);
  if (
    String.fromCharCode(...data.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...data.subarray(8, 12)) === "WEBP"
  ) {
    return webpSize(data, view);
  }
  return svgSize(new TextDecoder().decode(data.subarray(0, 4096)));
}
