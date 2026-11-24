# Component index

The CSS tools (`optimizeCss`, `OptimizeCssPlugin`, `optimizeCarbonCss`, the CLI) prune against an index of the `bx--` classes each Carbon component renders, built from your installed `carbon-components-svelte`, so it matches your version, older or newer than this package.

| | |
| :--- | :--- |
| Parsing | With [svelte-ast](https://github.com/metonym/svelte-ast), bundled in, so your project's `svelte` version doesn't matter |
| Cost | Built once, well under a second |
| Cache | `node_modules/.cache/carbon-preprocess-svelte/<carbon-version>_<preprocessor-version>.json`; bumping either package rebuilds it. A linked Carbon checkout (`bun link`, `npm link`, `workspace:`) isn't cached, so source edits apply on the next build. |
| On failure | The build warns and leaves Carbon CSS unpruned, instead of failing |

`optimizeImports` doesn't use it: it reads import paths from Carbon's `src/index.js`.
