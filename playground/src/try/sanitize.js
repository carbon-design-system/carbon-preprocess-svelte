// The Try page's preview renders a draft's HTML, which a shared link can
// carry: drop what runs code (scripts, frames, event handlers, javascript:
// URLs) before it reaches the page.

const DROP = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "base",
  "meta",
  "link",
  "form",
  "noscript",
]);
const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "xlink:href",
  "poster",
  "data",
]);
const UNSAFE_URL = /^\s*(?:javascript|vbscript|data):/i;
const IMAGE_DATA = /^\s*data:image\/(?:png|gif|jpe?g|webp|avif);/i;

/** `html` without elements and attributes that run code. */
export function sanitize(html) {
  const doc = new DOMParser().parseFromString(
    `<body>${html}</body>`,
    "text/html",
  );
  for (const element of [...doc.body.querySelectorAll("*")]) {
    if (DROP.has(element.localName.toLowerCase())) {
      element.remove();
      continue;
    }
    for (const { name, value } of [...element.attributes]) {
      const lower = name.toLowerCase();
      const unsafeUrl =
        URL_ATTRIBUTES.has(lower) &&
        UNSAFE_URL.test(value) &&
        !IMAGE_DATA.test(value);
      if (lower.startsWith("on") || unsafeUrl || lower === "srcdoc")
        element.removeAttribute(name);
    }
  }
  return doc.body.innerHTML;
}
