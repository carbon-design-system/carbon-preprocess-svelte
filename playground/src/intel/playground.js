// "Open in Svelte Playground": the example (and its local modules) as a
// playground project, in the URL hash the way svelte.dev writes it: JSON,
// gzipped, base64url (sveltejs/svelte.dev, packages/gzip). The playground
// loads npm imports itself; an `App.svelte` wrapper adds Carbon's CSS for the
// reader's theme and renders the example.

/** gzip + base64url, as svelte.dev's `compress_and_encode_text`. */
export async function compressAndEncode(text) {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

const file = (name, contents) => ({
  type: "file",
  name,
  basename: name,
  contents,
  text: true,
});

/**
 * A playground URL for `files` (`{ name, code }[]`, the example first).
 * `theme`: a Carbon theme for the CSS (`white`, `g10`, `g80`, `g90`, `g100`).
 */
export async function playgroundUrl(
  files,
  { name = "Carbon example", theme = "white" } = {},
) {
  const [main, ...rest] = files;
  const exampleName = main.name.endsWith(".svelte")
    ? main.name
    : "Example.svelte";
  const app = `<script>
  import Example from "./${exampleName}";
</script>

<svelte:head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/carbon-components-svelte/css/${theme}.css" />
</svelte:head>

<div style="padding: 1rem">
  <Example />
</div>
`;
  const project = {
    name,
    files: [
      file("App.svelte", app),
      file(exampleName, main.code),
      ...rest.map((f) => file(f.name, f.code)),
    ],
    tailwind: false,
  };
  return `https://svelte.dev/playground/untitled#${await compressAndEncode(JSON.stringify(project))}`;
}
