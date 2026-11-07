# vite-markdown@svelte-5

Used for end-to-end testing and development: Svelte 5, the experimental `markdown()` preprocessor, and `optimizeCss`.

[`src/guide.md`](src/guide.md) is a page written in Markdown. It renders with Carbon's `Prose` and uses [`src/DocLayout.svelte`](src/DocLayout.svelte) as its layout, which builds an "On this page" list from the `headings` export. The page covers:

- headings, with ids and anchors;
- inline code, and braces that stay literal;
- a task list;
- GitHub alerts (`> [!NOTE]`);
- a table with column alignment;
- fenced code, rendered as `CodeSnippet`;
- a live component block with blank lines inside;
- an `{#if}` block.

## Quick start

```sh
# In the repo root: build the library and link it
bun run build
bun link

# In this folder
bun i
bun run dev       # http://localhost:5173, `?theme=g100` for dark
bun run build     # prints the optimizeCss reduction
bun run preview
```

## Trying the unreleased `Prose`

`markdown()` wraps pages in `Prose` only when the installed `carbon-components-svelte` ships it. No published release does yet, so with the npm package the page renders as plain, mostly unstyled HTML.

To see it styled, point `node_modules/carbon-components-svelte` at a checkout of the Prose branch whose CSS is built (`bun build:css` in that checkout):

```sh
rm -rf node_modules/carbon-components-svelte
ln -s /path/to/carbon-components-svelte node_modules/carbon-components-svelte
bun run dev
```

`resolve.dedupe: ["svelte"]` in `vite.config.ts` keeps the checkout's own `svelte` copy out of the bundle. Run `bun i` to go back to the npm package.
