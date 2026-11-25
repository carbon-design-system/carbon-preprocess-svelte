# CLI

Prunes built CSS files in place, for pipelines with no plugin hook. File names don't change, so a name hashed from the CSS before pruning can stay the same across builds that prune differently: don't cache them as immutable. It finds the components to keep by scanning `--content` files for Carbon imports (barrel or direct paths) and literal `bx--` tokens, and prunes [by the props](optimize-css.md#pruning-by-props) those files pass, so `--content` must cover every file that renders Carbon components. It shares the plugins' [blind spot](optimize-css.md#optimizecss-api).

**Jump to:** [Command](#command) · [Sample output](#sample-output) · [Options](#options)

## Command

```sh
npx carbon-preprocess-svelte optimize-css "dist/**/*.css"
```

Run it after the build step:

```json
{
  "scripts": {
    "build": "esbuild src/main.ts --bundle --outdir=dist && carbon-preprocess-svelte optimize-css \"dist/**/*.css\""
  }
}
```

With Bun, the build step is `bun build src/main.ts --outdir dist`.

## Sample output

```
$ carbon-preprocess-svelte optimize-css "dist/**/*.css"
carbon-preprocess-svelte: pruned Carbon CSS
  dist/assets/index-CU4gbKFa.css  606.3 kB  →  53.2 kB  -91%
  dist/assets/About-Bq9xLm6t.css   38.0 kB  →   3.3 kB  -91%
                                  ──────────────────────────
  2 stylesheets                   644.3 kB  →  56.5 kB  -91%
```

It prints a row per stylesheet it pruned, the largest savings first, and a total when there's more than one; past five, the rest fold into one row. Color shows in a terminal, and not under `NO_COLOR`, in CI or when piped.

With `--report`:

```
carbon-preprocess-svelte report
  Components that can render (2): Accordion, Button
  Kept whatever renders: content 12 tokens, safelist 3 entries
  Assets:
    dist/assets/index-CU4gbKFa.css   1,204 rules removed   606.26 kB -> 53.22 kB
```

## Options

```
Usage: carbon-preprocess-svelte optimize-css [options] <css-file-or-glob>...

Removes unused Carbon styles from built CSS files, in place.
Carbon components are detected from imports in the files matched by --content,
and their styles pruned by the props those files pass: --content must cover
every file that renders Carbon components.

Options:
  --content <glob>        Source files to scan for Carbon imports and literal
                          bx-- classes. Repeatable.
                          Default: src/**/*.{svelte,js,ts,mjs}
  --components <a,b,c>    Component names to keep in addition to detected ones.
  --safelist <selector>   Class selector to always keep. Repeatable. Wrap in
                          slashes for a RegExp: --safelist "/^\.bx--btn--/"
  --preserve-all-ibm-fonts
                          Keep every IBM Plex @font-face rule.
  --exclude <a,b,c>       Components that keep every variant's styles, as if
                          rendered with any props.
  --cwd <dir>             Project directory; globs and carbon-components-svelte
                          resolve from it. Default: process.cwd()
  --dry-run               Print sizes, write nothing.
  --report                Print the components that can render, and what was
                          kept.
  --silent                Suppress the per-file size log.
  --json                  Print the result as one JSON object on stdout, and
                          an error as JSON too. Not with --report.
  -v, --version           Print the version.
  -h, --help              Show this help.

Exit status: 0 when done; 2 when called wrong, when there's nothing to
prune (no CSS file matched, no Carbon import found), or when the analysis
of the --content files fails, which leaves every file unchanged.

For agents and scripts: pass --json and read stdout. A run prints
{ schemaVersion, ok: true, dryRun, summary: { files, pruned, before, after },
files: [{ file, before, after, removed }] }, sizes in bytes; an exit 2 prints
{ schemaVersion, ok: false, error: { kind, message } }, where kind is usage,
input or failure.
```
