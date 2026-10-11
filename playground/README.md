# Playground

carbon-preprocess-svelte's own docs-site testbed: a Vite app whose pages go
through `markdown()`, whose imports go through `optimizeImports()`, whose CSS
goes through `optimizeCss()`, and whose code views use the browser-safe
`carbon-preprocess-svelte/code`. CI builds it (with the examples' CSS
snapshot) and runs its browser tests.

```sh
bun run playground            # from the repo root: install, then `vite`
```

It uses the installed `carbon-components-svelte`, which has no `Prose` yet:
pages then render as plain HTML (Carbon's reset leaves them without spacing),
Prose's settings are off, and a notice above the page says so. To work on
Prose, point the playground at a checkout that has it, once, in
`playground/.env.local` (git-ignored, paths relative to `playground/`):

```sh
CCS_DIR=../../carbon-components-svelte
```

or for one run: `CCS_DIR=../carbon-components-svelte bun run playground`. The
tests and the e2e build ignore `.env.local` (set `CCS_DIR` in the environment
to test against a checkout).

With `CCS_DIR`, the app also lists the checkout's docs pages (`CCS_PAGES`,
default `ComboBox,Form,FloatingPortal,Prose,SessionStorage`), renders their
framed examples, and reads its `COMPONENT_API.json` for hover cards. Without
it, the component API is generated with sveld from the installed package
(cached in `node_modules/.cache/playground/`), and Prose is off unless the
installed CCS has it.

## Tests

```sh
bun run test:playground       # from the repo root
```

`tests/run.ts` builds and links the package, type-checks the playground and
every example, builds the playground, serves it, and runs the browser tests
(`tests/*.browser.ts`, Playwright and `bun test`). `PLAYGROUND_SKIP_SETUP=1`
reuses the last build and install. Against a running instance:
`PLAYGROUND_URL=http://localhost:5173 bun test ./playground/tests/code-views.browser.ts`.

- **`pages`:** every page loads without errors, with the loading techniques
  on and off.
- **`shell`:** side nav navigation, settings into the URL and the changed
  tags (and back), the no-Prose notice, and axe on the header, side nav, and
  settings panel.
- **`code-views`:** hover cards and their underlines, the package manager
  switch, per-command copy, line links (and reloading to them), links into
  collapsed lines, Show more, file tabs and their overflow, folds, synced
  groups, type error squiggles, and "Open in Svelte Playground".
- **`accessibility`:** axe on the code views in white and g100; syntax colors
  on every line band and ANSI colors on the background at 4.5:1 or more
  (white, g10, g100; axe can't see Highlight API colors).
- **`performance`:** no load or scroll task over 200 ms
  (`PLAYGROUND_LONG_TASK_MS`), hover under 1 ms per pointer move.
- **Type-checked examples** (`bun run typecheck:examples` in this folder):
  every live and framed example's JSDoc and TypeScript views, through
  svelte-check against CCS's types. It fails on an error
  `expected-type-errors.json` doesn't list. With `CCS_DIR`, errors in the
  checkout's own docs are reported, not failed. `--strict` adds implicit-any
  and null checks.

## The shell

The playground is itself a Carbon app, built with carbon-components-svelte
and the same plugins as its pages:

- **UI Shell:** the header holds a light/dark switch, **About this build**
  (the CCS in use, Prose, the page count), and **Settings**. The side nav lists
  the pages, with the CCS checkout's docs pages in their own section.
- **Settings** are grouped (Prose, Code, Appearance, Loading) as Carbon
  controls: a select, a content switcher for two to four values, a toggle for
  on/off. Settings that need Prose are off without it; loading settings reload
  the page.
- **Changed settings** show above the page as tags: dismiss one to reset it.
- **One registry:** `src/shell/options.js` lists every option once (its
  values, default, group, and control). The settings panel, the URL, the
  tags, and the Matrix's axes all read it, so a new option is one entry plus
  whatever applies it in `App.svelte`.
- `?chrome=0` hides the shell, for screenshots and the tests.

Every setting is in the URL, by its key:

| Param | Values |
| --- | --- |
| `page` | `KitchenSink`, `Matrix`, `Stress`, `MountBench`, `InteractBench`, and with `CCS_DIR`, CCS docs pages |
| `scope` | `runs`: one Prose per run of Markdown between components (`.svx`, `proseScope: "markdown"`). `page`: one Prose for the page (`.md`, a symlink) |
| `variant`, `measure`, `linkTone`, `tableWidth`, `kbd`, `dividers`, `scrollMargin` | Prose's props |
| `theme` | `system`, `white`, `g10`, `g80`, `g90`, `g100` |
| `codeVariant`, `terminal` | Code type apart from Prose's variant (`compact`); a theme for terminal blocks (`g100`) |
| `syntax` | `build` (spans), `runtime` (CSS Custom Highlight API), `off` |
| `code`, `pm` | `ts` for the TypeScript views; `pnpm`, `yarn`, `bun` for npm commands |
| `lazy`, `cv`, `aot` | `0` turns a loading technique off, for comparison |
| `columns`, `group` | The Matrix's axes (also on the Matrix page) |
| `chrome=0` | Hides the shell |

- **KitchenSink** shows every Markdown element and code-block feature. Its
  Button `tooltip` example is a deliberate type error.
- **Matrix** lays out element groups (`src/samples/*.sample`) against one
  option, each cell in its own theme.
- **Stress** is a load and scroll fixture: one 1,600-line block and 60 small
  ones, written at startup (git-ignored).
- **MountBench** and **InteractBench** measure CCS components:
  `scripts/mount-bench.ts` and `scripts/interact-bench.ts`.

## Code views

`src/CodeView.svelte` renders fenced code and examples (the renderers in
`vite.config.ts` decide which), as a docs site would:

- **Build-time views:** the renderer prepares each view's text (markers,
  prompts, and diff signs removed), its JSDoc and TypeScript views, token data
  (`encodeTokens`), hover-card positions, and type errors. The browser paints
  colors with the CSS Custom Highlight API (one text node per line) and loads
  the component API only on the first hover or focus.
- **Hover cards** (`src/intel/`): components, props, events, bindings, local
  symbols, imports (with icon previews), Svelte blocks, CSS tokens. Symbols
  with a card are underlined from the start; ← and → step through them.
- **Lines:** `{1,3-5}`, `ins=`, `del=`, `focus=`, `[!code …]` markers, line
  numbers and line links (`#code-8-L14`, shift-click for a range), soft wrap,
  folds (`collapse={2-9}`), diffs (` ```diff-svelte `), terminal sessions
  (per-command copy, ANSI colors).
- **Headers:** file and status icons (`codeIcons`, Carbon's by default),
  `kind`, `do`/`dont`, `::: compare`, `iconOnly`, per-block `theme` and
  `variant`.
- **Switches:** JS/TS, npm/pnpm/yarn/bun, file tabs (`::: code-group`, synced
  with `group="…"`), and framed examples' local modules as tabs.
- **Show more:** past 15 lines, with `hidden="until-found"` so find in page
  still reaches hidden lines.
- **Loading:** controls, painting, and live examples mount near the viewport;
  lines behind Show more render while idle; `content-visibility` skips
  off-screen blocks.
- **Open in Svelte Playground:** the example as shown, with its modules and the
  theme's CSS.

`src/theme-scopes.js` makes any element with a `theme` attribute a themed
region, by copying each theme's tokens from `all.css`. CCS defines them on
`:root` only.

## Scripts

Against a running playground (`PLAYGROUND_URL`, default
`http://localhost:5173`):

```sh
bun scripts/screenshot.ts <name> "<query>" [--sections | --element "<sel>" | --viewport "#id"]
bun scripts/perf-check.ts "page=Stress"       # long tasks, DOM size, highlight ranges, hover cost
bun scripts/profile-files.ts "page=Stress"    # CPU time of a load, by source file
bun scripts/mount-bench.ts                    # CCS mount cost per component
bun scripts/interact-bench.ts                 # CCS interaction latency on large data
```

And on their own:

```sh
bun scripts/typecheck-examples.ts [--strict]
bun scripts/gen-syntax-css.ts                 # src/syntax.css from @carbon/themes
CCS_DIR=… bun scripts/highlight-corpus-check.ts   # tokenize every CCS docs sample
bun scripts/playground-live-check.ts          # open a generated playground link on svelte.dev
```
